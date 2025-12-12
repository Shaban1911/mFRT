
import { useEffect, useRef, useState, useCallback } from 'react';
import * as mpPose from '@mediapipe/pose';
import { PoseState, SafetyZone, POSE_LANDMARKS } from '../types';

// ==================================================================================
// INLINE WORKER: BIO-DIGITAL PHYSICS KERNEL (v11.0 - GOLD MASTER)
// ==================================================================================
const WORKER_CODE = `
/**
 * NEURO-SYMBOLIC REHAB AGENT: PHYSICS KERNEL v11.0 (GOLD MASTER)
 * Protocol: Modified Functional Reach Test (mFRT)
 * 
 * TUNING v11.0:
 * 1. PERSISTENCE BUFFERS: 200ms Glitch Guard (6 frames) for all faults.
 * 2. BIOMECHANICAL TOLERANCE: Relaxed thresholds for natural thoracic coupling.
 * 3. FUSION SCALING: Dual-source calibration maintained.
 */

// --- 1. ADVANCED MATH KERNEL ---

class Vec3 {
    static create(x, y, z) { return { x, y, z }; }
    static sub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
    static add(a, b) { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
    static mul(v, s) { return { x: v.x * s, y: v.y * s, z: v.z * s }; }
    static div(v, s) { return s === 0 ? { x: 0, y: 0, z: 0 } : { x: v.x / s, y: v.y / s, z: v.z / s }; }
    
    static dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
    
    static cross(a, b) {
        return {
            x: a.y * b.z - a.z * b.y,
            y: a.z * b.x - a.x * b.z,
            z: a.x * b.y - a.y * b.x
        };
    }
    
    static mag(v) { return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z); }
    
    static normalize(v) {
        const m = Vec3.mag(v);
        return m === 0 ? { x: 0, y: 0, z: 0 } : { x: v.x / m, y: v.y / m, z: v.z / m };
    }

    static project(v, n) {
        return Vec3.dot(v, n);
    }

    static angleBetween(a, b) {
        const dot = Vec3.dot(Vec3.normalize(a), Vec3.normalize(b));
        return Math.acos(Math.max(-1, Math.min(1, dot))) * (180 / Math.PI);
    }
}

class SavitzkyGolaySolver {
    constructor() {
        this.window = [];
        this.timestamps = [];
        this.MAX_SIZE = 5; 
        this.coeffs_v = [-0.2, -0.1, 0, 0.1, 0.2]; 
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
        if (this.window.length < this.MAX_SIZE) return { v: 0, valid: false };
        const dt = (this.timestamps[this.MAX_SIZE-1] - this.timestamps[0]) / 1000;
        if (dt <= 0) return { v: 0, valid: false };
        
        let v = 0;
        for (let i = 0; i < this.MAX_SIZE; i++) {
            v += this.window[i] * this.coeffs_v[i];
        }
        const step = dt / (this.MAX_SIZE - 1);
        return { v: v / step, valid: true };
    }
    reset() { this.window = []; this.timestamps = []; }
}

class KinematicChain {
    constructor() {
        this.x = new SavitzkyGolaySolver();
        this.y = new SavitzkyGolaySolver();
        this.z = new SavitzkyGolaySolver();
        this.lastValidPoint = null;
        this.lastTime = 0;
    }

    update(point, t, scaleFactor) {
        if (this.lastValidPoint && this.lastTime > 0) {
            const dt = (t - this.lastTime) / 1000;
            if (dt > 0) {
                const distUnits = Vec3.mag(Vec3.sub(point, this.lastValidPoint));
                const distCm = distUnits * scaleFactor;
                const instSpeed = distCm / dt;
                // Hard cap for teleportation glitches
                if (instSpeed > 500.0) return { vel: {x:0,y:0,z:0}, speed: 0, valid: false, glitch: true };
            }
        }
        
        this.lastValidPoint = point;
        this.lastTime = t;

        this.x.push(point.x, t);
        this.y.push(point.y, t);
        this.z.push(point.z, t);
        const sx = this.x.solve();
        const sy = this.y.solve();
        const sz = this.z.solve();
        
        const speed = Math.sqrt(sx.v*sx.v + sy.v*sy.v + sz.v*sz.v);
        
        return {
            vel: { x: sx.v, y: sy.v, z: sz.v }, 
            speed: speed,
            valid: sx.valid,
            glitch: false
        };
    }
    reset() { 
        this.x.reset(); this.y.reset(); this.z.reset(); 
        this.lastValidPoint = null;
        this.lastTime = 0;
    }
}

// --- 2. MEDICAL ENGINE (Gold Master) ---

class MedicalEngine {
    constructor() {
        this.handKinematics = new KinematicChain();
        this.hipKinematics = new KinematicChain();
        this.side = 'LEFT';
        
        this.patientHeightCm = 170;
        this.patientArmLengthCm = 75;
        this.scaleFactor = 0; 
        
        this.phase = 'UNSTABLE'; 
        this.stabilityCounter = 0;
        this.pendingForceLock = false; 
        
        // GLITCH GUARD: Persistence Buffers
        this.counters = { 
            rotation: 0, 
            lift: 0, 
            lean: 0, 
            slip: 0,
            momentum: 0
        };

        this.basis = {
            origin: null, 
            x: null,      
            y: null,      
            z: null       
        };
        
        this.anchors = {
            startKnuckle: null,
            midHip: null,
            spineLength: 0,
            shoulderVector: null, 
            initialShoulderAngle: 0 
        };
        
        this.maxReachCm = 0;
        this.failReason = null;
        this.lastValidDirection = { x: 0, y: 0, z: 0 }; 
    }

    setSide(side) {
        this.side = side;
        this.reset();
    }
    
    calibrate(payload) {
        this.patientHeightCm = payload.height;
        this.patientArmLengthCm = payload.armLength;
        this.pendingForceLock = true;
        this.phase = 'UNSTABLE';
    }

    reset() {
        this.handKinematics.reset();
        this.hipKinematics.reset();
        this.phase = 'UNSTABLE';
        this.stabilityCounter = 0;
        this.pendingForceLock = false;
        this.maxReachCm = 0;
        this.failReason = null;
        this.basis = { origin: null, x: null, y: null, z: null };
        this.counters = { rotation: 0, lift: 0, lean: 0, slip: 0, momentum: 0 };
    }

    getIndices() {
        const isRight = this.side === 'RIGHT';
        return {
            SHOULDER: isRight ? 12 : 11,
            ELBOW: isRight ? 14 : 13,
            WRIST: isRight ? 16 : 15,
            HIP: isRight ? 24 : 23,
            LEFT_SHOULDER: 11,
            RIGHT_SHOULDER: 12,
            LEFT_HIP: 23,
            RIGHT_HIP: 24,
            ACTIVE_SHOULDER: isRight ? 12 : 11,
            ACTIVE_WRIST: isRight ? 16 : 15,
            ACTIVE_INDEX: isRight ? 20 : 19
        };
    }

    computeBasis(worldLandmarks) {
        const idx = this.getIndices();
        const ls = worldLandmarks[idx.LEFT_SHOULDER];
        const rs = worldLandmarks[idx.RIGHT_SHOULDER];
        const lh = worldLandmarks[idx.LEFT_HIP];
        const rh = worldLandmarks[idx.RIGHT_HIP];
        
        const midHip = Vec3.mul(Vec3.add(lh, rh), 0.5);
        const midShoulder = Vec3.mul(Vec3.add(ls, rs), 0.5);
        
        // 1. Primary Axis: Spine (Y)
        const spineVec = Vec3.sub(midShoulder, midHip);
        const Y = Vec3.normalize(spineVec);
        
        // 2. Secondary Axis: Shoulders (X - Rough)
        const shoulderVec = Vec3.sub(rs, ls);
        const X_rough = Vec3.normalize(shoulderVec);
        
        // 3. Tertiary Axis: Forward (Z)
        let Z = Vec3.cross(X_rough, Y);
        Z = Vec3.normalize(Z);
        
        // --- STRICT Z-AXIS ALIGNMENT (v10.0) ---
        // Force Z to point in direction of the active arm.
        const armShoulder = worldLandmarks[idx.ACTIVE_SHOULDER];
        const armWrist = worldLandmarks[idx.ACTIVE_WRIST];
        const armVec = Vec3.sub(armWrist, armShoulder);
        
        // If Dot(Z, ArmVec) is negative, Z is pointing backwards. Flip it.
        const alignment = Vec3.dot(Z, Vec3.normalize(armVec));
        if (alignment < 0) {
            Z = Vec3.mul(Z, -1);
        }

        // 4. Re-Orthogonalize X
        const X = Vec3.normalize(Vec3.cross(Y, Z));
        
        return {
            x: X,
            y: Y,
            z: Z,
            origin: midHip,
            rawSpineLength: Vec3.mag(spineVec),
            rawShoulderVec: shoulderVec
        };
    }

    process(landmarks, worldLandmarks, timestamp) {
        if (!landmarks || !worldLandmarks) return null;
        const idx = this.getIndices();

        // --- 1. DATA ACQUISITION ---
        const wrist = worldLandmarks[idx.WRIST];
        const elbow = worldLandmarks[idx.ELBOW];
        const lh = worldLandmarks[idx.LEFT_HIP];
        const rh = worldLandmarks[idx.RIGHT_HIP];
        const currentMidHip = Vec3.mul(Vec3.add(lh, rh), 0.5);
        const ls = worldLandmarks[idx.LEFT_SHOULDER];
        const rs = worldLandmarks[idx.RIGHT_SHOULDER];
        const currentMidShoulder = Vec3.mul(Vec3.add(ls, rs), 0.5);

        // --- 2. VIRTUAL KNUCKLE ---
        let knuckle;
        const forearmVec = Vec3.sub(wrist, elbow);
        const vecMag = Vec3.mag(forearmVec);
        if (vecMag < 0.05) {
            knuckle = Vec3.add(wrist, Vec3.mul(this.lastValidDirection, vecMag * 0.4));
        } else {
            const dir = Vec3.normalize(forearmVec);
            this.lastValidDirection = dir;
            knuckle = Vec3.add(wrist, Vec3.mul(dir, vecMag * 0.4)); 
        }

        // --- 3. FUSION SCALING & BASIS ---
        const currentBasis = this.computeBasis(worldLandmarks);
        const spineMeters = currentBasis.rawSpineLength;
        
        // Scale A: Spine-Derived (Fallback)
        // Sitting trunk length approx 29% of standing height
        const scaleSpine = (this.patientHeightCm * 0.29) / spineMeters; 

        // Scale B: Arm-Derived (Precision)
        const as = worldLandmarks[idx.ACTIVE_SHOULDER];
        const ai = worldLandmarks[idx.ACTIVE_INDEX];
        const armMeters = Vec3.mag(Vec3.sub(ai, as));
        const scaleArm = this.patientArmLengthCm / armMeters;

        // FUSION LOGIC: Divergence Check
        const divergence = Math.abs(scaleArm - scaleSpine) / scaleSpine;
        
        // This is calculated every frame but only applied during LOCK
        let calculatedScale = scaleSpine; // Default Safe
        let scaleSource = 'SPINE';

        if (divergence < 0.20) {
            calculatedScale = scaleArm;
            scaleSource = 'ARM';
        }

        const activeScale = (this.phase !== 'UNSTABLE' && this.scaleFactor > 0) 
            ? this.scaleFactor 
            : calculatedScale;

        // --- 4. FORCE LOCK HANDLER ---
        if (this.pendingForceLock) {
            this.basis = currentBasis;
            this.anchors.startKnuckle = knuckle;
            this.anchors.midHip = currentMidHip;
            this.anchors.spineLength = spineMeters;
            this.anchors.shoulderVector = Vec3.normalize(currentBasis.rawShoulderVec); // Store unit vector
            
            // LOCK THE SCALE NOW
            this.scaleFactor = calculatedScale;
            
            this.phase = 'LOCKED'; 
            this.pendingForceLock = false;
            this.maxReachCm = 0;
            this.failReason = null;
            this.counters = { rotation: 0, lift: 0, lean: 0, slip: 0, momentum: 0 };
        }

        // --- 5. KINEMATICS ---
        const handKin = this.handKinematics.update(knuckle, timestamp, activeScale);
        const hipKin = this.hipKinematics.update(currentMidHip, timestamp, activeScale);
        
        if (handKin.glitch) return { status: 'GLITCH', stabilityProgress: 0 };
        
        const handSpeed = handKin.speed * activeScale; 
        const hipSpeed = hipKin.speed * activeScale; 

        // --- 6. STATE MACHINE ---
        
        let stabilityProgress = 0;
        let reachCm = 0;
        
        if (this.phase === 'UNSTABLE') {
             if (handSpeed < 1.5 && hipSpeed < 1.5) {
                this.stabilityCounter++;
            } else {
                this.stabilityCounter = 0;
            }
            stabilityProgress = Math.min(100, (this.stabilityCounter / 45) * 100);
        }
        
        else if (this.phase === 'LOCKED') {
            stabilityProgress = 100;
            
            // CALCULATE REACH CONTINUOUSLY
            const displacement = Vec3.sub(knuckle, this.anchors.startKnuckle);
            reachCm = Vec3.project(displacement, this.basis.z) * activeScale;
            
            // Trigger: Velocity > 5.0 OR Distance > 4.0cm 
            if (handSpeed > 5.0 || reachCm > 4.0) {
                this.phase = 'REACHING';
                this.counters = { rotation: 0, lift: 0, lean: 0, slip: 0, momentum: 0 }; // Reset counters on start
            }
            
            // Abandonment Reset (Backward > 10cm)
            if (reachCm < -10.0) {
                 this.phase = 'UNSTABLE';
                 this.stabilityCounter = 0;
            }
        }
        
        else if (this.phase === 'REACHING') {
            stabilityProgress = 100;
            
            // A. CALCULATE REACH
            const displacement = Vec3.sub(knuckle, this.anchors.startKnuckle);
            reachCm = Vec3.project(displacement, this.basis.z) * activeScale;
            
            if (reachCm > this.maxReachCm) this.maxReachCm = reachCm;
            
            // B. ANTI-CHEAT ENGINE (v11.0 GOLD MASTER)
            // Uses Persistence Buffers (Counters) to prevent flickery fails.
            
            // Calculate Lean Angle (Degrees from Calibrated Vertical)
            const currentSpineVec = Vec3.sub(currentMidShoulder, currentMidHip);
            const leanDeg = Vec3.angleBetween(currentSpineVec, this.basis.y);
            
            // 1. FAIL_TORSO_SLIP (Dynamic)
            // Base Tolerance: 8.0cm (Relaxed from 5.0) + Lean Bonus
            const maxAllowedSlip = 8.0 + (leanDeg / 10.0);
            
            const hipShift = Vec3.sub(currentMidHip, this.anchors.midHip);
            const slipCm = Math.abs(Vec3.project(hipShift, this.basis.z)) * activeScale;
            
            if (slipCm > maxAllowedSlip) this.counters.slip++;
            else this.counters.slip = Math.max(0, this.counters.slip - 1);
            
            if (this.counters.slip > 6) this.failReason = 'TORSO_SLIP';
            
            // 2. FAIL_ROTATION (Shoulder Axis Deviation)
            // Limit: 25.0 degrees (Relaxed from 15.0)
            const currentShoulderVec = Vec3.normalize(currentBasis.rawShoulderVec);
            const rotationDeg = Vec3.angleBetween(currentShoulderVec, this.anchors.shoulderVector);
            
            if (rotationDeg > 25.0) this.counters.rotation++;
            else this.counters.rotation = Math.max(0, this.counters.rotation - 1);

            if (this.counters.rotation > 6) this.failReason = 'ROTATION';
            
            // 3. FAIL_LATERAL_LEAN
            // Limit: 15.0 cm (Relaxed from 10.0)
            const leanCm = Math.abs(Vec3.project(displacement, this.basis.x)) * activeScale;
            
            if (leanCm > 15.0) this.counters.lean++;
            else this.counters.lean = Math.max(0, this.counters.lean - 1);

            if (this.counters.lean > 6) this.failReason = 'LATERAL_LEAN';
            
            // 4. FAIL_BUTT_LIFT
            // Limit: 8.0 cm (Relaxed from 4.0)
            const hipRiseCm = Vec3.project(hipShift, this.basis.y) * activeScale;
            
            if (hipRiseCm > 8.0) this.counters.lift++;
            else this.counters.lift = Math.max(0, this.counters.lift - 1);

            if (this.counters.lift > 6) this.failReason = 'BUTT_LIFT';
            
            // 5. FAIL_MOMENTUM
            // Limit: 90.0 cm/s
            if (handSpeed > 90.0) this.counters.momentum++;
            else this.counters.momentum = Math.max(0, this.counters.momentum - 1);

            if (this.counters.momentum > 6) this.failReason = 'MOMENTUM';

            // C. TRANSITION -> RETURNING
            if (this.maxReachCm > 5.0) {
                if (handSpeed < 1.5 || reachCm < this.maxReachCm * 0.8) {
                     this.phase = 'RETURNING';
                }
            }
        }
        
        else if (this.phase === 'RETURNING') {
            stabilityProgress = 0;
            reachCm = this.maxReachCm; 
            
            const distFromStart = Vec3.mag(Vec3.sub(knuckle, this.anchors.startKnuckle)) * activeScale;
            
            if (distFromStart < 5.0 && handSpeed < 2.0) {
                this.phase = 'LOCKED'; 
                this.maxReachCm = 0; 
                this.failReason = null;
                this.counters = { rotation: 0, lift: 0, lean: 0, slip: 0, momentum: 0 };
            }
        }

        // --- 7. OUTPUT GENERATION ---
        
        const spineVec2D = { x: landmarks[idx.SHOULDER].x - landmarks[idx.HIP].x, y: landmarks[idx.SHOULDER].y - landmarks[idx.HIP].y };
        const vertical2D = { x: 0, y: -1 };
        const leanAngle = Math.acos(
            (spineVec2D.x * vertical2D.x + spineVec2D.y * vertical2D.y) / 
            (Math.sqrt(spineVec2D.x**2 + spineVec2D.y**2) * 1)
        ) * (180/Math.PI);

        let zone = 'GREEN';
        const faults = [];
        if (this.failReason) {
            zone = 'RED';
            faults.push(this.failReason);
        }

        const reachScore = Math.min(50, (reachCm / 30) * 50);
        const stabilityScore = zone === 'RED' ? 0 : 50;
        const kpi = Math.round(reachScore + stabilityScore);

        // isCalibrated is TRUE if we are in LOCKED, REACHING, or RETURNING
        const isCalibrated = this.phase !== 'UNSTABLE';

        return {
            estimatedReachCm: reachCm,
            velocity: handSpeed,
            angle: leanAngle, 
            zone: zone,
            kpiScore: kpi,
            isTracking: true,
            isCalibrated: isCalibrated, 
            faults: faults,
            stabilityProgress: stabilityProgress,
            internalPhase: this.phase
        };
    }
}

const engine = new MedicalEngine();

self.onmessage = (e) => {
    const { type, payload } = e.data;
    if (type === 'SET_SIDE') engine.setSide(payload);
    else if (type === 'CALIBRATE') {
        engine.calibrate(payload); 
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

// Updated signature to accept object calibration
interface CalibrationPayload {
    height: number;
    armLength: number;
}

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

    useEffect(() => {
        workerRef.current?.postMessage({ type: 'SET_SIDE', payload: activeSide });
    }, [activeSide]);

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
                    modelComplexity: 2, 
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

    const calibrate = useCallback((payload: CalibrationPayload) => {
        workerRef.current?.postMessage({ type: 'CALIBRATE', payload: payload });
        if (onCalibrationCmd) onCalibrationCmd();
    }, [onCalibrationCmd]);

    return { poseState, calibrate, isLoading, error };
};
