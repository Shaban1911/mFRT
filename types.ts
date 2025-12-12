

export enum SafetyZone {
  GREEN = 'GREEN',   // Safe
  YELLOW = 'YELLOW', // Warning
  RED = 'RED'        // Critical
}

export enum SessionPhase {
  LOBBY = 'LOBBY',
  CALIBRATION = 'CALIBRATION',
  GAME = 'GAME',
  COACHING = 'COACHING',
  SUMMARY = 'SUMMARY'
}

export interface Landmark {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

export interface Vector3D {
  x: number;
  y: number;
  z: number;
}

export interface PoseState {
  landmarks: Landmark[] | null; // 2D for Rendering
  worldLandmarks: Landmark[] | null; // 3D for Physics
  angle: number;
  armAngle: number; // Shoulder flexion angle relative to horizon
  velocity: number; // deg/s
  estimatedReachCm: number; // Anthropometric estimate (Standard Adult Male Proxy)
  normalizedReach: number; // Ratio of arm length (0.0 - 1.0+) for Gaming
  zone: SafetyZone;
  isCalibrated: boolean;
  isTracking: boolean;
  kpiScore: number;
  smoothness: number;
  gestureProgress: number;
  detectedStartSide: 'LEFT' | 'RIGHT' | null;
  stopProgress: number;
}

export interface GameTarget {
  id: number;
  x: number; // Screen % (0-1)
  y: number; // Screen % (0-1)
  size: number;
  hit: boolean;
  spawnTime: number;
}

export interface GameState {
  score: number;
  combo: number;
  targets: GameTarget[];
  isPlaying: boolean;
}

export interface AttemptMetric {
  id: number;
  maxReachCm: number; // Stored as Clinical CM
  maxLeanAngle: number;
  clinicalScore: number;
  maxVelocity: number;
  triggeredFail: boolean;
  failureSnapshot?: string; // Base64 image of the moment they failed
}

export const POSE_LANDMARKS = {
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_PINKY: 17,
  RIGHT_PINKY: 18,
  LEFT_INDEX: 19,
  RIGHT_INDEX: 20,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  NOSE: 0,
};

export interface PoseResults {
    poseLandmarks: Landmark[];
    poseWorldLandmarks?: Landmark[];
    image: any;
}