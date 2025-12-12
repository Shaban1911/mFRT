
import { useEffect, useRef, useState, useCallback } from 'react';
import * as mpPose from '@mediapipe/pose';
import { PoseState, SafetyZone, POSE_LANDMARKS } from '../types';

// ==================================================================================
// INLINE WORKER: MEDICAL-GRADE PHYSICS ENGINE (mFRT Protocol v4.0 - Anthropometry)
// ==================================================================================
const WORKER_CODE = `
/**
 * NEURO-SYMBOLIC REHAB AGENT: PHYSICS KERNEL v4.0
 * Protocol: Modified Functional Reach Test (mFRT)
 * 
 * CORE UPDATES (Drillis & Contini 1966):
 * 1. ANTHROPOMETRY: Uses Patient Height to derive Segment Lengths.
 *    - Arm Length (Acromion->Knuckle) ~= 0.42 * Height.
 *    - ScaleFactor derived from this expectation vs. measured pixels/units.
 * 2. HEMIPLEGIC HAND: Handles "Claw Hand" (Flexor Synergy).
 *    - If Index occluded, projects Virtual Knuckle from Elbow->Wrist vector.
 * 3. CLINICAL COMPENSATIONS: 
 *    - Trunk Rotation: >10cm Z-depth shift.
 *    - Butt Lift: >5% Spine Length Y-rise.
 */

// --- 1. MATH KERNEL (3D METRIC) ---

class Vec3 {
    static sub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
    static add(a, b) { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
    static mul(v, s) { return { x: v.x * s, y: v.y * s, z: v.z * s }; }
    static dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
    static mag(v) { return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z); }
    static normalize(v) {
        const m = Vec3.mag(v);
        return m === 0 ? { x: 0, y: 0, z: 0 } : { x: v.x / m, y: v.y / m, z: v.z / m };
    }
    
    static project(v, normal) {
        const n = Vec3.normalize(normal);
        const scalar = Vec3.dot(v, n);
        return scalar; 
    }

    static deviationFromHorizontal(v) {
        const dist = Vec3.mag(v);
        if (dist < 0.001) return 0;
        const angleRad = Math.asin(v.y / dist); 
        return angleRad * (180 / Math.PI);
    }
}

class SavitzkyGolaySolver {
    constructor() {
        this.window = [];
        this.timestamps = [];
        this.MAX_SIZE = 7;
        this.coeffs_p = [-0.0952, 0.1428, 0.2857, 0.3333, 0.2857, 0.1428, -0.0952];
        this.coeffs_v = [-0.1071, -0.0714, -0.0357, 0, 0.0357, 0.0714, 0.1071];
    }
    push(val, t) {
        this.window.push(val);
        this.timestamps.push(t);
        if (this.window.length > this.MAX_SIZE) {
            this.window.shift();
            this.timestamps.shift();
        }
    }
    solve() {
        if (this.window.length < this.MAX_SIZE) return { p: 0, v: 0, valid: false };
        const dt = (this.timestamps[this.MAX_SIZE-1] - this.timestamps[0]) / 1000; 
        if (dt <= 0) return { p: 0, v: 0, valid: false };
        const step = dt / (this.MAX_SIZE - 1);
        let p = 0, v = 0;
        for (let i = 0; i < this.MAX_SIZE; i++) {
            p += this.window[i] * this.coeffs_p[i];
            v += this.window[i] * this.coeffs_v[i];
        }
        return { p: p, v: v / step, valid: true };
    }
    reset() { this.window = []; this.timestamps = []; }
}

class KinematicChain {
    constructor() {
        this.x = new SavitzkyGolaySolver();
        this.y = new SavitzkyGolaySolver();
        this.z = new SavitzkyGolaySolver();
    }
    update(point, t) {
        this.x.push(point.x, t);
        this.y.push(point.y, t);
        this.z.push(point.z, t);
        const sx = this.x.solve();
        const sy = this.y.solve();
        const sz = this.z.solve();
        return {
            pos: { x: sx.p, y: sy.p, z: sz.p },
            vel: { x: sx.v, y: sy.v, z: sz.v }, 
            speed: Math.sqrt(sx.v*sx.v + sy.v*sy.v + sz.v*sz.v),
            valid: sx.valid
        };
    }
    reset() { this.x.reset(); this.y.reset(); this.z.reset(); }
}

// --- 2. MEDICAL PHYSICS ENGINE ---

class MedicalEngine {
    constructor() {
        this.kinematics = new KinematicChain();
        this.side = 'LEFT';
        
        this.baseline = {
            isSet: false,
            patientHeightCm: 170, // Default, updated on calibration
            scaleFactor: 1.0,     // Units -> CM conversion
            spineLengthUnits: 0,  
            hipYUnits: 0,         
            shoulderZDiffUnits: 0 
        };
        
        this.trial = {
            state: 'IDLE', 
            startKnuckle: null,
            forwardAxis: null,
            idleTimer: 0,
        };

        this.history = { ldljBuffer: [], lastSpeed: 0 };
        this.gesture = { holdTime: 0, side: null, stopHoldTime: 0 };
    }

    setSide(side) {
        this.side = side;
        this.reset();
    }

    reset() {
        this.kinematics.reset();
        this.trial = { state: 'IDLE', startKnuckle: null, forwardAxis: null, idleTimer: 0 };
        this.baseline.isSet = false;
        this.gesture = { holdTime: 0, side: null, stopHoldTime: 0 };
    }

    getIndices() {
        const isRight = this.side === 'RIGHT';
        return {
            SHOULDER: isRight ? 12 : 11,
            ELBOW: isRight ? 14 : 13,
            WRIST: isRight ? 16 : 15,
            INDEX: isRight ? 20 : 19,
            HIP: isRight ? 24 : 23,
            KNEE: isRight ? 26 : 25, 
            HEEL: isRight ? 30 : 29,
            LEFT_SHOULDER: 11,
            RIGHT_SHOULDER: 12,
            NOSE: 0
        };
    }

    // --- ANTHROPOMETRIC CALIBRATION ---
    calibrate(landmarks, worldLandmarks, patientHeightCm) {
        if(!worldLandmarks) return;
        
        const idx = this.getIndices();
        const sh = worldLandmarks[idx.SHOULDER];
        const elbow = worldLandmarks[idx.ELBOW];
        const wrist = worldLandmarks[idx.WRIST];
        const hip = worldLandmarks[idx.HIP];
        const lSh = worldLandmarks[idx.LEFT_SHOULDER];
        const rSh = worldLandmarks[idx.RIGHT_SHOULDER];

        // 1. Measure Arm Segment Lengths in World Units
        const upperArmUnits = Vec3.mag(Vec3.sub(elbow, sh));
        const forearmUnits = Vec3.mag(Vec3.sub(wrist, elbow));
        const totalArmUnits = upperArmUnits + forearmUnits;

        // 2. Derive Scale Factor using Drillis & Contini (1966)
        // Segment length: Acromion to Wrist ~= 42-44% of Height.
        // We use 0.35 for Sh->Wrist to be safe, or just calculate pixels per cm directly.
        // Better: Total Arm (Sh->Finger) is approx 42% height.
        // Let's use: Shoulder to Wrist is approx 0.35 * Height.
        const expectedArmLengthCm = patientHeightCm * 0.35; 
        
        // Units to CM conversion
        // If MP World units are meters, this should be close to 100. But often they are normalized or approximate.
        this.baseline.scaleFactor = expectedArmLengthCm / totalArmUnits;
        this.baseline.patientHeightCm = patientHeightCm;

        // 3. Store Structural Baselines
        this.baseline.spineLengthUnits = Vec3.mag(Vec3.sub(sh, hip));
        this.baseline.hipYUnits = hip.y;
        this.baseline.shoulderZDiffUnits = Math.abs(lSh.z - rSh.z);
        
        this.baseline.isSet = true;
    }

    process(landmarks, worldLandmarks, timestamp) {
        if (!landmarks || !worldLandmarks) return null;
        const idx = this.getIndices();
        
        // Use World Landmarks for Physics (Angles, Distances)
        const sh = worldLandmarks[idx.SHOULDER];
        const elbow = worldLandmarks[idx.ELBOW];
        const wrist = worldLandmarks[idx.WRIST];
        const index = worldLandmarks[idx.INDEX];
        const hip = worldLandmarks[idx.HIP];
        const lSh = worldLandmarks[idx.LEFT_SHOULDER];
        const rSh = worldLandmarks[idx.RIGHT_SHOULDER];

        // 1. VIRTUAL KNUCKLE LOGIC (Hemiplegic Hand Handling)
        let knuckle;
        const forearmVec = Vec3.sub(wrist, elbow);
        const forearmLen = Vec3.mag(forearmVec);

        // Check if index finger is reliable (not curled/occluded)
        // We check landmarks[idx.INDEX].visibility (2D visibility score)
        const indexVis = landmarks[idx.INDEX] ? landmarks[idx.INDEX].visibility : 0;
        
        if (indexVis && indexVis > 0.6) {
            // Standard: Knuckle is 35% along Wrist->Index vector
            const handVec = Vec3.sub(index, wrist);
            knuckle = Vec3.add(wrist, Vec3.mul(handVec, 0.35));
        } else {
            // Hemiplegic Fallback: Project from Forearm Vector
            // Extend forearm by ~15% of its length to approximate knuckle position
            const dir = Vec3.normalize(forearmVec);
            const offset = Vec3.mul(dir, forearmLen * 0.15); 
            knuckle = Vec3.add(wrist, offset);
        }

        // 2. KINEMATICS
        const kin = this.kinematics.update(knuckle, timestamp);
        if (!kin.valid) return { status: 'INITIALIZING', ...this.detectGestures(landmarks) };

        // 3. CALIBRATION CHECK
        if (this.pendingCalibration) {
            // Consume the pending flag inside the loop to ensure we use valid frame data
            this.calibrate(landmarks, worldLandmarks, this.pendingHeight || 170);
            this.pendingCalibration = false;
        }
        if (!this.baseline.isSet) return { status: 'UNCALIBRATED', ...this.detectGestures(landmarks) };

        // 4. STATE MACHINE (Dynamic Zeroing)
        const cmSpeed = kin.speed * this.baseline.scaleFactor; // Convert units/sec to cm/sec

        if (this.trial.state === 'IDLE') {
            if (kin.speed < 0.05) { // Low noise threshold
                 // Exponential smoothing for zero-point
                 if (!this.trial.startKnuckle) this.trial.startKnuckle = knuckle;
                 else this.trial.startKnuckle = Vec3.add(Vec3.mul(this.trial.startKnuckle, 0.9), Vec3.mul(knuckle, 0.1));
            } else if (cmSpeed > 5.0) { // Breakout > 5cm/s
                this.trial.state = 'REACHING';
                // Lock Forward Axis (Projected onto Horizontal Plane)
                const reachVec = Vec3.sub(this.trial.startKnuckle, sh);
                this.trial.forwardAxis = Vec3.normalize({ x: reachVec.x, y: 0, z: reachVec.z });
            }
        } else if (this.trial.state === 'REACHING') {
            if (kin.speed < 0.02) {
                this.trial.idleTimer += 16;
                if (this.trial.idleTimer > 1500) {
                    this.trial.state = 'IDLE';
                    this.trial.idleTimer = 0;
                }
            } else this.trial.idleTimer = 0;
        }

        // 5. PROJECTED REACH CALCULATION
        let reachCm = 0;
        if (this.trial.startKnuckle && this.trial.forwardAxis) {
            const moveVec = Vec3.sub(knuckle, this.trial.startKnuckle);
            const projectedUnits = Vec3.project(moveVec, this.trial.forwardAxis);
            reachCm = Math.max(0, projectedUnits * this.baseline.scaleFactor);
        }

        // 6. CLINICAL FAULT DETECTION
        const faults = [];
        let zone = 'GREEN';

        // A. BUTT LIFT (Ischial Anchor)
        // Check Absolute Hip Y change. (Note: MediaPipe Y increases downwards).
        // If Hip Y decreases (moves up), we have a lift.
        const hipLiftUnits = this.baseline.hipYUnits - hip.y; 
        const hipLiftCm = hipLiftUnits * this.baseline.scaleFactor;
        const maxLiftCm = (this.baseline.spineLengthUnits * this.baseline.scaleFactor) * 0.05; // 5% tolerance
        if (hipLiftCm > maxLiftCm) faults.push('BUTT_LIFT');

        // B. TRUNK ROTATION
        // Check Delta Z change
        const currentZDiff = Math.abs(lSh.z - rSh.z);
        const rotationDeltaUnits = Math.abs(currentZDiff - this.baseline.shoulderZDiffUnits);
        const rotationDeltaCm = rotationDeltaUnits * this.baseline.scaleFactor;
        if (rotationDeltaCm > 10.0) faults.push('ROTATION'); // >10cm rotation

        // C. ARM STABILITY
        const armVec = Vec3.sub(knuckle, sh);
        const armAngle = Vec3.deviationFromHorizontal(armVec);
        if (Math.abs(armAngle) > 20) faults.push(armAngle > 0 ? 'ARM_DROP' : 'ARM_HIKE');

        // D. TRUNK COLLAPSE
        const trunkY = Math.abs(sh.y - hip.y);
        if (trunkY < (this.baseline.spineLengthUnits * 0.85)) faults.push('TRUNK_COLLAPSE');

        if (faults.length > 0) zone = 'RED';

        // 7. SMOOTHNESS (LDLJ)
        const acc = (kin.speed - this.history.lastSpeed) / 0.033;
        this.history.lastSpeed = kin.speed;
        this.history.ldljBuffer.push({v: kin.speed, a: acc});
        if (this.history.ldljBuffer.length > 60) this.history.ldljBuffer.shift();
        
        let ldlj = -10;
        if (this.history.ldljBuffer.length > 10) {
            let sumJ2 = 0; let maxV = 0.001;
            for(let i=1; i<this.history.ldljBuffer.length; i++) {
                const j = (this.history.ldljBuffer[i].a - this.history.ldljBuffer[i-1].a);
                sumJ2 += j*j;
                if(this.history.ldljBuffer[i].v > maxV) maxV = this.history.ldljBuffer[i].v;
            }
            ldlj = -Math.log(sumJ2 / (maxV*maxV) + 1e-9);
            if (ldlj < -20) ldlj = -20; if (ldlj > 0) ldlj = 0;
        }

        // 8. SCORING
        const reachScore = Math.min(50, (reachCm / 30) * 50);
        const stabilityScore = zone === 'RED' ? 0 : 25;
        const smoothScore = Math.min(25, Math.max(0, (ldlj + 20) * 1.66));
        const kpi = Math.round(reachScore + stabilityScore + smoothScore);
        
        const spineVec = Vec3.sub(sh, hip);
        const leanAngle = 90 - Math.abs(Vec3.deviationFromHorizontal(spineVec));

        return {
            estimatedReachCm: reachCm,
            velocity: cmSpeed,
            angle: leanAngle,
            armAngle: armAngle,
            zone: zone,
            smoothness: ldlj,
            kpiScore: kpi,
            isTracking: true,
            isCalibrated: this.baseline.isSet,
            faults: faults,
            ...this.detectGestures(landmarks)
        };
    }

    detectGestures(landmarks) {
        // Reuse existing gesture logic for hands-free control
        const nose = landmarks[0];
        const lWrist = landmarks[15];
        const rWrist = landmarks[16];
        const lHip = landmarks[23];
        let gestureProgress = 0, detectedStartSide = null, stopProgress = 0;

        if (nose && lWrist && rWrist && lHip) {
             const wristDist = Math.abs(lWrist.x - rWrist.x);
             const wristYDiff = Math.abs(lWrist.y - rWrist.y);
             if (wristDist < 0.2 && wristYDiff < 0.2 && lWrist.y < lHip.y) {
                 this.gesture.stopHoldTime += 16; 
             } else {
                 this.gesture.stopHoldTime = Math.max(0, this.gesture.stopHoldTime - 50);
             }
             stopProgress = Math.min(100, (this.gesture.stopHoldTime / 1500) * 100);

             const lUp = lWrist.y < nose.y - 0.1; 
             const rUp = rWrist.y < nose.y - 0.1;
             
             if (lUp && !rUp) {
                 if (this.gesture.side === 'LEFT') this.gesture.holdTime += 16;
                 else { this.gesture.side = 'LEFT'; this.gesture.holdTime = 0; }
             } else if (rUp && !lUp) {
                 if (this.gesture.side === 'RIGHT') this.gesture.holdTime += 16;
                 else { this.gesture.side = 'RIGHT'; this.gesture.holdTime = 0; }
             } else {
                 this.gesture.holdTime = Math.max(0, this.gesture.holdTime - 50);
                 if (this.gesture.holdTime === 0) this.gesture.side = null;
             }
             gestureProgress = Math.min(100, (this.gesture.holdTime / 1500) * 100);
             detectedStartSide = gestureProgress > 0 ? this.gesture.side : null;
        }
        return { gestureProgress, detectedStartSide, stopProgress };
    }
}

const engine = new MedicalEngine();

self.onmessage = (e) => {
    const { type, payload } = e.data;
    if (type === 'SET_SIDE') engine.setSide(payload);
    else if (type === 'CALIBRATE') {
        engine.pendingCalibration = true;
        engine.pendingHeight = payload; // Accept Patient Height
    }
    else if (type === 'PROCESS') {
        const result = engine.process(payload.landmarks, payload.worldLandmarks, payload.timestamp);
        if (result) self.postMessage({ type: 'RESULT', payload: result });
    }
};
`;

const DEFAULT_POSE_STATE: PoseState = {
    landmarks: null,
    worldLandmarks: null,
    angle: 0,
    armAngle: 0,
    velocity: 0,
    estimatedReachCm: 0,
    normalizedReach: 0,
    zone: SafetyZone.GREEN,
    isCalibrated: false,
    isTracking: false,
    kpiScore: 0,
    smoothness: 0,
    gestureProgress: 0,
    detectedStartSide: null,
    stopProgress: 0
};

export const usePoseEstimation = (
    videoElement: HTMLVideoElement | null,
    activeSide: 'LEFT' | 'RIGHT',
    onCalibrationCmd?: () => void
) => {
    const [poseState, setPoseState] = useState<PoseState>(DEFAULT_POSE_STATE);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const workerRef = useRef<Worker | null>(null);
    const poseRef = useRef<any | null>(null);
    const lastLandmarksRef = useRef<{ landmarks: any, worldLandmarks: any } | null>(null);

    // 1. Initialize Worker
    useEffect(() => {
        if (!workerRef.current) {
            const blob = new Blob([WORKER_CODE], { type: 'application/javascript' });
            const worker = new Worker(URL.createObjectURL(blob));

            worker.onmessage = (e) => {
                const { type, payload } = e.data;
                if (type === 'RESULT') {
                    setPoseState(prev => ({
                        ...prev,
                        ...payload,
                        landmarks: lastLandmarksRef.current?.landmarks || null,
                        worldLandmarks: lastLandmarksRef.current?.worldLandmarks || null,
                    }));
                }
            };
            workerRef.current = worker;
        }
        return () => {
            workerRef.current?.terminate();
            workerRef.current = null;
        };
    }, []);

    // 2. Update Side
    useEffect(() => {
        workerRef.current?.postMessage({ type: 'SET_SIDE', payload: activeSide });
    }, [activeSide]);

    // 3. Initialize MediaPipe
    useEffect(() => {
        const loadPose = async () => {
            try {
                const MP = mpPose as any;
                const PoseClass = (MP.Pose || MP.default?.Pose || (window as any).Pose) as any;

                if (!PoseClass) throw new Error("MediaPipe Pose class not found.");

                const pose = new PoseClass({
                    locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`,
                });

                pose.setOptions({
                    modelComplexity: 2, // High complexity for accuracy
                    smoothLandmarks: true,
                    enableSegmentation: false,
                    smoothSegmentation: false,
                    minDetectionConfidence: 0.5,
                    minTrackingConfidence: 0.5,
                });

                pose.onResults((results: any) => {
                    setIsLoading(false);
                    if (!results.poseLandmarks) return;

                    lastLandmarksRef.current = {
                        landmarks: results.poseLandmarks,
                        worldLandmarks: results.poseWorldLandmarks
                    };

                    workerRef.current?.postMessage({
                        type: 'PROCESS',
                        payload: {
                            landmarks: results.poseLandmarks,
                            worldLandmarks: results.poseWorldLandmarks,
                            timestamp: Date.now()
                        }
                    });
                });
                poseRef.current = pose;
            } catch (err) {
                console.error(err);
                setError("Failed to initialize computer vision engine.");
                setIsLoading(false);
            }
        };
        loadPose();
        return () => { poseRef.current?.close(); };
    }, []);

    // 4. Video Loop
    useEffect(() => {
        let animationFrameId: number;
        const loop = async () => {
            if (videoElement && poseRef.current && videoElement.readyState >= 2) {
                try { await poseRef.current.send({ image: videoElement }); } 
                catch (e) { console.error("Frame send error:", e); }
            }
            animationFrameId = requestAnimationFrame(loop);
        };
        loop();
        return () => cancelAnimationFrame(animationFrameId);
    }, [videoElement]);

    // 5. Calibration Handler (Accepts optional height override)
    const calibrate = useCallback((patientHeightCm: number = 170) => {
        workerRef.current?.postMessage({ type: 'CALIBRATE', payload: patientHeightCm });
        if (onCalibrationCmd) onCalibrationCmd();
    }, [onCalibrationCmd]);

    return { poseState, calibrate, isLoading, error };
};
