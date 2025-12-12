
import { SafetyZone } from '../types';

export const PROTOCOL_CONFIG = {
    // Safety Thresholds (mFRT v2.1)
    // NOTE: Red Zone is now triggered ONLY by Compensations (Arm Drop, Butt Lift, Rotation) or Fall Risk.
    // Deep flexion (>60) is allowed and encouraged if controlled.
    THRESHOLDS: {
        [SafetyZone.GREEN]: 60,  // 0-60°: Safe Hip Hinge range
        [SafetyZone.YELLOW]: 90, // 60-90°: Extreme reach (Caution)
    },
    
    COMPENSATIONS: {
        // Shoulder Flexion Maintenance
        MIN_ARM_ANGLE: 75, // Degrees. Arm must stay roughly horizontal (90° +/- 15°)
        
        // Ischial Support
        BUTT_LIFT_RATIO: 0.05, // 5% of spine length deviation is a lift
        
        // Trunk Control
        ROTATION_RATIO: 0.15, // Z-depth difference / Shoulder Width
    },
    
    // Fall Detection
    VELOCITY_LIMIT: 50, // deg/s
    
    // Anthropometry (Standard Human Arm Length Estimate for Clinical Proxy)
    // Used when real height is unknown.
    STANDARD_ARM_LENGTH_CM: 65,
    
    // KPI Weights (Total 100)
    KPI_WEIGHTS: {
        REACH: 50,      // Max Excursion
        CONTROL: 50,    // Smoothness + Stability
    },

    // MediaPipe Config
    MODEL_COMPLEXITY: 2, // 0=Lite, 1=Full, 2=Heavy (Best for side views/occlusion)
};
