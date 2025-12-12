
import React, { useRef, useEffect, useState } from 'react';
import { PoseState, SafetyZone, POSE_LANDMARKS, SessionPhase } from '../types';
import { Info, AlertTriangle, Crosshair, Ruler, RotateCcw, Camera, AlertOctagon } from 'lucide-react';

interface ReflexMirrorProps {
  onZoneChange: (zone: SafetyZone, angle: number, velocity: number, snapshot: string) => void;
  onCalibrate: () => void;
  poseState: PoseState;
  isLoading: boolean;
  error?: string | null;
  onVideoMount: (video: HTMLVideoElement | null) => void;
  onShowGuide: () => void;
  sessionPhase: SessionPhase;
  attemptCount: number;
  activeSide: 'LEFT' | 'RIGHT';
}

export const ReflexMirror: React.FC<ReflexMirrorProps> = ({ 
  onZoneChange, 
  onCalibrate, 
  poseState, 
  isLoading,
  error: visionError,
  onVideoMount,
  onShowGuide,
  sessionPhase,
  attemptCount,
  activeSide
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoElementRef = useRef<HTMLVideoElement | null>(null);
  const [prevZone, setPrevZone] = useState<SafetyZone>(SafetyZone.GREEN);
  const lastAlertTime = useRef<number>(0);

  // Camera State
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [streamReady, setStreamReady] = useState(false);

  // 1. CRITICAL: Camera Initialization Logic (Robust Retry)
  useEffect(() => {
    let stream: MediaStream | null = null;
    let isMounted = true;

    const getCameraStream = async (constraints: MediaStreamConstraints, timeoutMs = 5000) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const s = await navigator.mediaDevices.getUserMedia(constraints);
            clearTimeout(timeoutId);
            return s;
        } catch (e) {
            clearTimeout(timeoutId);
            throw e;
        }
    };

    const startCamera = async () => {
        try {
            setCameraError(null);
            
            // ATTEMPT 1: High Performance (720p @ 30fps)
            try {
                stream = await getCameraStream({
                    audio: false,
                    video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }
                }, 4000);
            } catch (err) {
                console.warn("HD Camera init failed, attempting fallback...", err);
                
                // ATTEMPT 2: Compatibility Mode (VGA, relaxed constraints)
                try {
                    stream = await getCameraStream({
                        audio: false,
                        video: { facingMode: 'user', width: { ideal: 640 } }
                    }, 4000);
                } catch (fallbackErr) {
                    throw new Error("Could not acquire camera stream. Device may be busy or blocked.");
                }
            }
            
            if (!isMounted) {
                stream?.getTracks().forEach(t => t.stop());
                return;
            }

            if (videoElementRef.current && stream) {
                videoElementRef.current.srcObject = stream;
                videoElementRef.current.setAttribute('playsinline', 'true'); // iOS compatibility
                
                // Wait for video to actually be ready
                await new Promise((resolve) => {
                    if (!videoElementRef.current) return resolve(true);
                    videoElementRef.current.onloadedmetadata = () => resolve(true);
                });
                
                await videoElementRef.current.play();
                
                if (isMounted) {
                    setStreamReady(true);
                    onVideoMount(videoElementRef.current);
                }
            }
        } catch (err: any) {
            console.error("Camera Final Error:", err);
            if (isMounted) {
                if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                    setCameraError("Camera permission denied. Please allow access in settings.");
                } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
                    setCameraError("Camera is busy. Close other apps using camera.");
                } else {
                    setCameraError(err.message || "Failed to start camera.");
                }
            }
        }
    };

    startCamera();

    return () => {
        isMounted = false;
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
        }
    };
  }, [onVideoMount]); 

  // 2. Skeleton Rendering Loop
  const drawSkeleton = (ctx: CanvasRenderingContext2D, landmarks: any[], zone: SafetyZone) => {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    
    let strokeColor = '#2DD4BF'; // Green/Teal
    if (zone === SafetyZone.YELLOW) strokeColor = '#FACC15';
    if (zone === SafetyZone.RED) strokeColor = '#EF4444';

    // 1. Draw Functional Neutral Line (Calibrated Spine Anchor)
    if (poseState.isCalibrated) {
        ctx.beginPath();
        const leftHip = landmarks[POSE_LANDMARKS.LEFT_HIP];
        const rightHip = landmarks[POSE_LANDMARKS.RIGHT_HIP];
        if (leftHip && rightHip) {
            const hipCenter = {
                x: (leftHip.x + rightHip.x) / 2,
                y: (leftHip.y + rightHip.y) / 2
            };
            // Draw anchor point
            ctx.arc(hipCenter.x * ctx.canvas.width, hipCenter.y * ctx.canvas.height, 6, 0, 2 * Math.PI);
            ctx.fillStyle = '#3B82F6'; // Blue
            ctx.fill();
            ctx.strokeStyle = 'rgba(59, 130, 246, 0.5)';
            ctx.stroke();
        }
    }

    // 2. Define Dynamic Kinematic Chain
    const isRight = activeSide === 'RIGHT';
    
    const ARM_LANDMARKS = {
        SHOULDER: isRight ? POSE_LANDMARKS.RIGHT_SHOULDER : POSE_LANDMARKS.LEFT_SHOULDER,
        ELBOW: isRight ? POSE_LANDMARKS.RIGHT_ELBOW : POSE_LANDMARKS.LEFT_ELBOW,
        WRIST: isRight ? POSE_LANDMARKS.RIGHT_WRIST : POSE_LANDMARKS.LEFT_WRIST,
        INDEX: isRight ? POSE_LANDMARKS.RIGHT_INDEX : POSE_LANDMARKS.LEFT_INDEX
    };

    const connections = [
      // Torso Box (Always Visible for Posture Check)
      [POSE_LANDMARKS.LEFT_SHOULDER, POSE_LANDMARKS.RIGHT_SHOULDER],
      [POSE_LANDMARKS.LEFT_SHOULDER, POSE_LANDMARKS.LEFT_HIP],
      [POSE_LANDMARKS.RIGHT_SHOULDER, POSE_LANDMARKS.RIGHT_HIP],
      [POSE_LANDMARKS.LEFT_HIP, POSE_LANDMARKS.RIGHT_HIP],
      
      // Dynamic Active Arm Chain
      [ARM_LANDMARKS.SHOULDER, ARM_LANDMARKS.ELBOW],
      [ARM_LANDMARKS.ELBOW, ARM_LANDMARKS.WRIST],
      [ARM_LANDMARKS.WRIST, ARM_LANDMARKS.INDEX], 
    ];

    ctx.lineWidth = 4;
    ctx.strokeStyle = strokeColor;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    connections.forEach(([start, end]) => {
        const p1 = landmarks[start];
        const p2 = landmarks[end];
        if (p1 && p2 && p1.visibility > 0.5 && p2.visibility > 0.5) {
            ctx.beginPath();
            ctx.moveTo(p1.x * ctx.canvas.width, p1.y * ctx.canvas.height);
            ctx.lineTo(p2.x * ctx.canvas.width, p2.y * ctx.canvas.height);
            ctx.stroke();
        }
    });

    // 3. Draw Reach Target (Active Fingertip/Virtual Knuckle)
    const tip = landmarks[ARM_LANDMARKS.INDEX];
    const wrist = landmarks[ARM_LANDMARKS.WRIST];
    
    // Fallback drawing if tip is hidden but wrist is visible (Hemiplegic logic visualizer)
    if (tip && tip.visibility > 0.5) {
        ctx.beginPath();
        ctx.arc(tip.x * ctx.canvas.width, tip.y * ctx.canvas.height, 8, 0, 2 * Math.PI);
        ctx.fillStyle = strokeColor;
        ctx.fill();
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 2;
        ctx.stroke();
    } else if (wrist && wrist.visibility > 0.5) {
        // Draw projected knuckle ghost
        ctx.beginPath();
        // Just a visual proxy, real math is in physics engine
        ctx.arc(wrist.x * ctx.canvas.width, wrist.y * ctx.canvas.height, 6, 0, 2 * Math.PI);
        ctx.fillStyle = strokeColor;
        ctx.globalAlpha = 0.5;
        ctx.fill();
        ctx.globalAlpha = 1.0;
    }
  };

  useEffect(() => {
    if (!canvasRef.current || !poseState.landmarks) return;
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    if (videoElementRef.current && videoElementRef.current.videoWidth > 0) {
        // Sync canvas size to video stream resolution
        canvasRef.current.width = videoElementRef.current.videoWidth;
        canvasRef.current.height = videoElementRef.current.videoHeight;
    }

    drawSkeleton(ctx, poseState.landmarks, poseState.zone);
  }, [poseState.landmarks, poseState.zone, poseState.isCalibrated, activeSide]);

  // Alert Logic
  useEffect(() => {
    if (poseState.zone === SafetyZone.RED && prevZone !== SafetyZone.RED) {
      const now = Date.now();
      // Debounce alerts (4s)
      if (now - lastAlertTime.current > 4000) { 
        lastAlertTime.current = now;
        if (canvasRef.current && videoElementRef.current) {
             const tempCanvas = document.createElement('canvas');
             tempCanvas.width = videoElementRef.current.videoWidth;
             tempCanvas.height = videoElementRef.current.videoHeight;
             const tCtx = tempCanvas.getContext('2d');
             if (tCtx) {
                 tCtx.drawImage(videoElementRef.current, 0, 0);
                 drawSkeleton(tCtx, poseState.landmarks || [], poseState.zone);
                 const snapshot = tempCanvas.toDataURL('image/jpeg', 0.8);
                 onZoneChange(SafetyZone.RED, poseState.angle, poseState.velocity, snapshot);
             }
        }
      }
    }
    setPrevZone(poseState.zone);
  }, [poseState.zone, prevZone, onZoneChange, activeSide]);

  const hasBody = poseState.isTracking;

  return (
    <div className="relative w-full h-full bg-black rounded-2xl overflow-hidden shadow-2xl border border-slate-700 group flex items-center justify-center">
      
      {/* Video Feed */}
      <video 
        ref={videoElementRef}
        className="absolute inset-0 w-full h-full object-cover transform scale-x-[-1]" 
        playsInline 
        muted
        autoPlay
      />
      
      <canvas 
        ref={canvasRef} 
        className="absolute inset-0 w-full h-full object-cover transform scale-x-[-1] pointer-events-none" 
      />

      {/* STOP GESTURE FEEDBACK OVERLAY */}
      {poseState.stopProgress && poseState.stopProgress > 0 ? (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-red-900/30 backdrop-blur-[2px] animate-in fade-in">
              <div className="relative">
                 <svg className="w-48 h-48 transform -rotate-90">
                    <circle cx="96" cy="96" r="90" stroke="#450a0a" strokeWidth="12" fill="none" />
                    <circle 
                        cx="96" cy="96" r="90" 
                        stroke="#ef4444" strokeWidth="12" fill="none" 
                        strokeDasharray="565" 
                        strokeDashoffset={565 - (565 * poseState.stopProgress) / 100}
                        strokeLinecap="round"
                    />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center text-red-100 font-bold">
                    <div className="text-3xl">STOPPING</div>
                    <div className="text-sm opacity-80 mt-1">HOLD X-POSE</div>
                </div>
              </div>
          </div>
      ) : null}

      {/* Error States */}
      {cameraError && (
          <div className="absolute inset-0 z-50 bg-slate-900 flex flex-col items-center justify-center p-6 text-center">
             <AlertOctagon className="w-16 h-16 text-red-500 mb-4" />
             <p className="font-bold text-xl text-white mb-2">Camera Access Failed</p>
             <p className="text-slate-400 max-w-md mb-6">{cameraError}</p>
             <button onClick={() => window.location.reload()} className="px-6 py-3 bg-slate-800 hover:bg-slate-700 rounded-lg text-white font-bold transition-colors border border-slate-600">
                 Retry Connection
             </button>
          </div>
      )}

      {/* Loading State */}
      {!cameraError && (!streamReady || isLoading) && (
        <div className="absolute inset-0 z-40 bg-slate-950 flex flex-col items-center justify-center p-6 text-center">
           <div className="relative">
               <div className="w-16 h-16 border-4 border-slate-800 border-t-teal-500 rounded-full animate-spin mb-4"></div>
               <Camera className="w-6 h-6 text-teal-500 absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-[calc(50%+16px)]" />
           </div>
           <p className="font-bold text-teal-400 tracking-wider">INITIALIZING VISION ENGINE</p>
           <p className="text-xs text-slate-500 mt-2">Loading TensorFlow Models & Camera Stream...</p>
        </div>
      )}

      {/* HUD */}
      {streamReady && hasBody && (
      <div className="absolute top-4 left-4 right-4 z-10 flex justify-between items-start">
         <div className="flex flex-col gap-2">
            <div className={`px-4 py-2 rounded-full font-bold backdrop-blur-md shadow-lg border transition-all duration-300 flex items-center gap-2 ${
                poseState.zone === SafetyZone.GREEN ? 'bg-teal-500/80 border-teal-400 text-white' :
                poseState.zone === SafetyZone.YELLOW ? 'bg-yellow-500/80 border-yellow-400 text-white' :
                'bg-red-500/80 border-red-400 text-white animate-pulse'
            }`}>
                {poseState.zone === SafetyZone.RED && <AlertTriangle className="w-4 h-4" />}
                {poseState.zone} ZONE
            </div>

            {poseState.isCalibrated && (
                <div className="flex flex-col gap-1 items-start animate-in fade-in slide-in-from-left-4">
                    <div className="flex items-center gap-2 text-xs font-mono text-white bg-black/60 px-2 py-1 rounded backdrop-blur border-l-2 border-teal-500">
                        <Ruler className="w-3 h-3 text-teal-400" />
                        REACH (EST): {poseState.estimatedReachCm.toFixed(1)} cm
                    </div>
                </div>
            )}
         </div>

         <div className="flex gap-2">
             <div className="px-3 py-1 bg-white/20 backdrop-blur rounded-lg text-white text-xs font-bold border border-white/20">
                ATTEMPT {Math.min(3, attemptCount + 1)}/3
            </div>
            <button 
                onClick={onShowGuide}
                className="p-2 bg-black/40 hover:bg-black/60 text-white rounded-full backdrop-blur border border-white/20 transition-all"
            >
                <Info className="w-5 h-5" />
            </button>
         </div>
      </div>
      )}

      {/* Calibration Controls */}
      {streamReady && !isLoading && hasBody && (
      <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 z-20 w-full px-4 flex justify-center">
         {!poseState.isCalibrated ? (
             <button 
                onClick={onCalibrate}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-8 py-4 rounded-full font-bold shadow-lg shadow-blue-900/50 transition-all hover:scale-105 animate-bounce-slow ring-4 ring-blue-500/30"
             >
                <Crosshair className="w-5 h-5" />
                CALIBRATE (SIT NEUTRAL)
             </button>
         ) : (
             <button 
                onClick={onCalibrate}
                className="flex items-center gap-2 bg-slate-900/80 hover:bg-slate-800 text-slate-300 px-4 py-2 rounded-full font-semibold backdrop-blur text-xs border border-slate-700 hover:text-white transition-colors"
             >
                <RotateCcw className="w-3 h-3" />
                Recalibrate
             </button>
         )}
      </div>
      )}
    </div>
  );
};
