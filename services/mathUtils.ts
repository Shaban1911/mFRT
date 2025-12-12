
import { Landmark, Vector3D, POSE_LANDMARKS } from '../types';

// ==========================================
// 1. SIGNAL PROCESSING (SOTA)
// ==========================================

export class OneEuroFilter {
  minCutoff: number;
  beta: number;
  dCutoff: number;
  xPrev: number | null = null;
  dxPrev: number = 0;
  tPrev: number | null = null;

  constructor(minCutoff = 1.0, beta = 0.007, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
  }

  filter(x: number, t: number): number {
    if (this.tPrev === null || this.xPrev === null) {
      this.xPrev = x;
      this.tPrev = t;
      return x;
    }

    const dt = (t - this.tPrev) / 1000.0;
    this.tPrev = t;

    if (dt <= 0) return this.xPrev;

    const dx = (x - this.xPrev) / dt;
    const edx = this.exponentialSmoothing(dx, this.dxPrev, dt, this.dCutoff);
    this.dxPrev = edx;

    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    const result = this.exponentialSmoothing(x, this.xPrev, dt, cutoff);
    
    this.xPrev = result;
    return result;
  }

  private exponentialSmoothing(x: number, xPrev: number, dt: number, cutoff: number): number {
    const tau = 1.0 / (2.0 * Math.PI * cutoff);
    const alpha = 1.0 / (1.0 + tau / dt);
    return xPrev + alpha * (x - xPrev);
  }
  
  reset() {
      this.xPrev = null;
      this.dxPrev = 0;
      this.tPrev = null;
  }
}

export class VectorFilter {
    xFilter: OneEuroFilter;
    yFilter: OneEuroFilter;
    zFilter: OneEuroFilter;

    constructor(minCutoff = 1.0, beta = 0.007, dCutoff = 1.0) {
        this.xFilter = new OneEuroFilter(minCutoff, beta, dCutoff);
        this.yFilter = new OneEuroFilter(minCutoff, beta, dCutoff);
        this.zFilter = new OneEuroFilter(minCutoff, beta, dCutoff);
    }

    filter(v: Vector3D, t: number): Vector3D {
        return {
            x: this.xFilter.filter(v.x, t),
            y: this.yFilter.filter(v.y, t),
            z: this.zFilter.filter(v.z, t)
        };
    }
    
    reset() {
        this.xFilter.reset();
        this.yFilter.reset();
        this.zFilter.reset();
    }
}

// ==========================================
// 2. VECTOR ALGEBRA
// ==========================================

export const createVector = (from: Vector3D, to: Vector3D): Vector3D => ({
  x: to.x - from.x,
  y: to.y - from.y,
  z: to.z - from.z
});

export const calculateMagnitude = (v: Vector3D): number => 
  Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);

export const calculateMidpoint = (a: Vector3D, b: Vector3D): Vector3D => ({
  x: (a.x + b.x) * 0.5,
  y: (a.y + b.y) * 0.5,
  z: (a.z + b.z) * 0.5
});

/**
 * Calculates the clinical angle between two vectors.
 * Used for trunk flexion and lateral deviation.
 */
export const calculateAngle = (v1: Vector3D, v2: Vector3D): number => {
  const dot = v1.x * v2.x + v1.y * v2.y + v1.z * v2.z;
  const magSq1 = v1.x*v1.x + v1.y*v1.y + v1.z*v1.z;
  const magSq2 = v2.x*v2.x + v2.y*v2.y + v2.z*v2.z;
  
  if (magSq1 < 1e-9 || magSq2 < 1e-9) return 0;

  const denom = Math.sqrt(magSq1 * magSq2);
  const cosTheta = dot / denom;
  return Math.acos(Math.max(-1, Math.min(1, cosTheta))) * (180.0 / Math.PI);
};

export const calculateReachEuclidean = (start: Vector3D, current: Vector3D): number => {
    // Assuming world landmarks in meters, return cm
    const v = createVector(start, current);
    const distMeters = calculateMagnitude(v);
    return distMeters * 100; 
};

// ==========================================
// 3. ANTHROPOMETRY & CLINICAL METRICS
// ==========================================

// Calculates pixels per cm based on user's arm length
export const calculateScaleFactor = (shoulder: Vector3D, indexFinger: Vector3D, standardArmCm: number = 65): number => {
    const armLengthPixels = calculateMagnitude(createVector(shoulder, indexFinger));
    if (armLengthPixels < 1) return 1; // Prevent div by zero
    return armLengthPixels / standardArmCm;
};

// Returns cm based on calibrated scale
export const calculateReachCm = (start: Vector3D, current: Vector3D, pixelsPerCm: number): number => {
    const distPixels = calculateMagnitude(createVector(start, current));
    return distPixels / pixelsPerCm;
};

// SAVITZKY-GOLAY FILTER (5-point, 2nd order)
// Used for smooth derivative (Velocity/Acceleration) calculation
export const calculateVelocitySG = (history: number[], dt: number): number => {
    if (history.length < 5) return 0;
    
    // Coefficients for 1st derivative (5 points)
    // [-2, -1, 0, 1, 2] / 10
    const p0 = history[history.length - 5];
    const p1 = history[history.length - 4];
    const p2 = history[history.length - 3];
    const p3 = history[history.length - 2];
    const p4 = history[history.length - 1];
    
    const weightedSum = (-2*p0) + (-1*p1) + (0*p2) + (1*p3) + (2*p4);
    const deriv = weightedSum / 10;
    
    return Math.abs(deriv / dt);
};

export const calculateSmoothness = (velocityHistory: number[], dt: number): number => {
    if (velocityHistory.length < 5) return -20; // Default bad smoothness
    // Simplistic SPARC-like metric using velocity changes (Jerk)
    let totalJerk = 0;
    for(let i=1; i<velocityHistory.length; i++) {
        const dv = velocityHistory[i] - velocityHistory[i-1];
        const jerk = dv / dt;
        totalJerk += jerk * jerk;
    }
    // Log dimensionless jerk (approx)
    const val = -Math.log(totalJerk / velocityHistory.length + 1e-9);
    // Clamp or scale if needed, for now raw value
    return val;
};

/**
 * DIGITAL BIOMARKER CALCULATION (v2.0 - mFRT)
 * 
 * Updated weights for Clinical Validity:
 * - REACH (50%): Max excursion.
 * - CONTROL (50%): Smoothness + Lateral Stability.
 * 
 * @param reachCm - Max excursion of the end effector (cm)
 * @param smoothness - Log Dimensionless Jerk (-20 to -5)
 * @param lateralDevRatio - Ratio of shoulder Z-depth difference (0.0 to 0.3+)
 * @returns 0-100 Score
 */
export const calculateDigitalBiomarker = (reachCm: number, smoothness: number, lateralDevRatio: number): number => {
    // 1. Reach Component (50 Points)
    // Target: 30cm = 50 pts (Seated Stroke Protocol)
    // CHANGED: Denominator updated from 45 to 30.
    const reachScore = Math.min(50, (reachCm / 30) * 50);

    // 2. Smoothness Component (25 Points)
    // Map -20 (ataxic) to -5 (smooth) -> 0 to 25
    // Normalization: (Val + 20) / 15 * 25
    const normSmooth = Math.max(0, Math.min(25, (smoothness + 20) * (25 / 15)));

    // 3. Stability Component (25 Points)
    // Penalize Lateral Sway (Coronal Plane Deviation)
    // lateralDevRatio > 0.15 is significant rotation/sway
    const swayPenalty = Math.max(0, (lateralDevRatio * 100) * 1.5); // 0.15 * 100 * 1.5 = 22.5 pts penalty
    const stabilityScore = Math.max(0, 25 - swayPenalty);

    return Math.round(reachScore + normSmooth + stabilityScore);
};

export const estimateFMA = calculateDigitalBiomarker;
