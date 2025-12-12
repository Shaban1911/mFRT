
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { ReflexMirror } from './components/ReflexMirror';
import { CoachPanel } from './components/CoachPanel';
import { ReportCard } from './components/ReportCard';
import { usePoseEstimation } from './hooks/usePoseEstimation';
import { useGeminiLive } from './hooks/useGeminiLive';
import { SafetyZone, SessionPhase, AttemptMetric } from './types';
import { Crosshair, Repeat, Mic, Square, Power, Activity } from 'lucide-react';

// Trial State Machine
type TrialPhase = 'IDLE' | 'REACHING' | 'RETURNING' | 'COOLDOWN';

function App() {
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);
  const [phase, setPhase] = useState<SessionPhase>(SessionPhase.LOBBY);
  const [activeSide, setActiveSide] = useState<'LEFT' | 'RIGHT'>('LEFT');
  const [showAutoStart, setShowAutoStart] = useState(false);
  const [isSystemInitialized, setIsSystemInitialized] = useState(false);

  // Clinical Protocol State
  const [history, setHistory] = useState<AttemptMetric[]>([]);
  const [trialPhase, setTrialPhase] = useState<TrialPhase>('IDLE');
  
  // Real-time tracking
  const trialStartTime = useRef<number>(0);
  const currentTrial = useRef({
      maxReach: 0,
      maxScore: 0,
      maxVel: 0,
      maxAngle: 0,
      fail: false,
      failSnapshot: undefined as string | undefined
  });

  // Helper for TTS
  const speak = (text: string) => {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.2;
      window.speechSynthesis.speak(u);
  };

  // Command Handlers
  const performCalibration = useCallback(() => {
      setPhase(SessionPhase.CALIBRATION);
      setHistory([]); 
  }, []);

  const performStartGame = useCallback(() => {
      setPhase(SessionPhase.GAME);
      setHistory([]);
      setTrialPhase('IDLE');
  }, []);

  const { poseState, calibrate, isLoading } = usePoseEstimation(videoElement, activeSide, performCalibration);
  
  const { isConnected, connect, sendVisualAlert, messages, resumeAudio, volume } = useGeminiLive({
      onCalibrationCmd: performCalibration,
      onStartGameCmd: performStartGame
  });

  // 1. SYSTEM INIT
  const handleSystemInit = async () => {
      await resumeAudio();
      connect();
      setIsSystemInitialized(true);
  };

  // 2. CALIBRATION LOGIC
  useEffect(() => {
      if (phase === SessionPhase.CALIBRATION && poseState.worldLandmarks) {
          calibrate();
      }
  }, [phase, calibrate, poseState.worldLandmarks]);

  useEffect(() => {
      let timeout: ReturnType<typeof setTimeout>;
      if (phase === SessionPhase.CALIBRATION && poseState.isCalibrated) {
          timeout = setTimeout(() => {
              setPhase(SessionPhase.GAME);
              setTrialPhase('IDLE');
              setHistory([]);
              speak("Calibration complete. Starting assessment.");
          }, 2000);
      }
      return () => clearTimeout(timeout);
  }, [phase, poseState.isCalibrated]);

  // 3. CLINICAL TRIAL STATE MACHINE (Robust)
  useEffect(() => {
      if (phase !== SessionPhase.GAME) return;

      const now = Date.now();
      const reach = poseState.estimatedReachCm;
      const vel = poseState.velocity;
      const angle = poseState.angle;
      const isRed = poseState.zone === SafetyZone.RED;

      // Update Peak Values if Active
      if (trialPhase === 'REACHING' || trialPhase === 'RETURNING') {
          currentTrial.current.maxReach = Math.max(currentTrial.current.maxReach, reach);
          currentTrial.current.maxVel = Math.max(currentTrial.current.maxVel, vel);
          currentTrial.current.maxAngle = Math.max(currentTrial.current.maxAngle, angle);
          currentTrial.current.maxScore = Math.max(currentTrial.current.maxScore, poseState.kpiScore);
          if (isRed) currentTrial.current.fail = true;
      }

      switch (trialPhase) {
          case 'IDLE':
              // Start Trigger: > 5.0cm
              if (reach > 5.0) {
                  setTrialPhase('REACHING');
                  trialStartTime.current = now;
                  currentTrial.current = { 
                      maxReach: reach, 
                      maxScore: 0, 
                      maxVel: 0, 
                      maxAngle: 0, 
                      fail: false, 
                      failSnapshot: undefined 
                  };
              }
              break;

          case 'REACHING':
              // A. Timeout Safety (10s)
              if (now - trialStartTime.current > 10000) {
                  setTrialPhase('RETURNING');
              }
              // B. Return Trigger
              // Must have reached at least 8cm to consider returning, else it's jitter
              if (currentTrial.current.maxReach > 8.0 && reach < currentTrial.current.maxReach * 0.9) {
                  setTrialPhase('RETURNING');
              }
              break;

          case 'RETURNING':
              // End Trigger: < 5.0cm (Back to Neutral)
              if (reach < 5.0) {
                  // VALIDATION
                  if (currentTrial.current.maxReach < 8.0) {
                      // FALSE START / TWITCH
                      speak("Relax. Get ready.");
                      setTrialPhase('IDLE');
                  } else {
                      // VALID TRIAL
                      const newMetric: AttemptMetric = {
                          id: Date.now(),
                          maxReachCm: currentTrial.current.maxReach,
                          maxLeanAngle: currentTrial.current.maxAngle,
                          clinicalScore: currentTrial.current.maxScore,
                          maxVelocity: currentTrial.current.maxVel,
                          triggeredFail: currentTrial.current.fail,
                          failureSnapshot: currentTrial.current.failSnapshot // <--- SAVE IT
                      };
                      
                      setHistory(prev => {
                          const updated = [...prev, newMetric];
                          // Feedback based on performance
                          const val = currentTrial.current.maxReach;
                          if (val > 25) speak("Excellent reach!");
                          else if (val > 15) speak("Good effort.");
                          else speak("Trial saved.");
                          return updated;
                      });
                      
                      currentTrial.current.failSnapshot = undefined;
                      setTrialPhase('COOLDOWN');
                  }
              }
              break;

          case 'COOLDOWN':
              // Handled by effect below to prevent rapid re-trigger
              break;
      }
  }, [poseState, phase, trialPhase]);

  // Cooldown Timer
  useEffect(() => {
      if (trialPhase === 'COOLDOWN') {
          const t = setTimeout(() => {
              setTrialPhase('IDLE');
          }, 3000);
          return () => clearTimeout(t);
      }
  }, [trialPhase]);

  // 4. PROTOCOL ENFORCEMENT (5 Trials -> Summary)
  useEffect(() => {
      if (phase === SessionPhase.GAME && history.length >= 5 && trialPhase === 'COOLDOWN') {
           setTimeout(() => {
               setPhase(SessionPhase.SUMMARY);
               speak("Session complete. Great job.");
           }, 2000);
      }
  }, [history.length, phase, trialPhase]);

  // 5. HANDS-FREE GESTURES (Lobby Only)
  useEffect(() => {
      if (phase === SessionPhase.LOBBY && poseState.gestureProgress >= 100) {
          if (poseState.detectedStartSide) {
              setActiveSide(poseState.detectedStartSide);
              performCalibration();
          }
      }
      setShowAutoStart(phase === SessionPhase.LOBBY && poseState.gestureProgress > 0);
  }, [poseState.gestureProgress, poseState.detectedStartSide, phase, performCalibration]);


  // RENDER
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col overflow-hidden font-sans selection:bg-teal-500/30">
      
      {/* SYSTEM INIT */}
      {!isSystemInitialized && (
        <div className="fixed inset-0 z-[100] bg-slate-950/90 backdrop-blur-xl flex items-center justify-center animate-in fade-in">
            <div className="text-center space-y-6">
                <div className="w-20 h-20 bg-teal-500/20 rounded-full flex items-center justify-center mx-auto animate-pulse">
                    <Power className="w-10 h-10 text-teal-400" />
                </div>
                <div>
                    <h1 className="text-3xl font-black text-white tracking-tight">NEURO-SYMBOLIC REHAB</h1>
                    <p className="text-slate-400 mt-2">Initialize Audio & Vision Engines</p>
                </div>
                <button 
                    onClick={handleSystemInit}
                    className="px-8 py-4 bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold rounded-xl transition-all shadow-lg shadow-teal-500/20"
                >
                    INITIALIZE SYSTEM
                </button>
            </div>
        </div>
      )}

      {/* HEADER */}
      <header className="px-6 py-4 flex justify-between items-center border-b border-slate-800 bg-slate-900/50 backdrop-blur-md z-50">
        <div className="flex items-center gap-3">
            <div className="w-3 h-3 bg-teal-500 rounded-full animate-pulse shadow-[0_0_10px_#14b8a6]"></div>
            <h1 className="text-xl font-bold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-teal-400 to-fuchsia-500">
                NS-RA <span className="text-slate-500 font-mono text-xs ml-2">mFRT Protocol</span>
            </h1>
        </div>
        <div className="flex items-center gap-4">
            {isConnected && (
                <div className="flex items-center gap-2 bg-slate-800/50 px-3 py-1.5 rounded-lg border border-slate-700">
                    <Mic className={`w-3 h-3 ${volume > 5 ? 'text-green-400' : 'text-slate-500'}`} />
                    <div className="flex gap-0.5 items-end h-3">
                        {[...Array(5)].map((_, i) => (
                            <div key={i} className={`w-1 rounded-t-sm transition-all duration-75 ${volume > (i * 20) ? 'bg-green-400' : 'bg-slate-600'}`} style={{ height: `${Math.max(20, Math.min(100, volume - (i * 20)))}%` }} />
                        ))}
                    </div>
                </div>
            )}
            <div className={`px-3 py-1 rounded-full text-xs font-mono border ${isConnected ? 'border-green-500/50 text-green-400 bg-green-500/10' : 'border-slate-700 text-slate-500'}`}>
                {isConnected ? 'AI: ONLINE' : 'AI: STANDBY'}
            </div>
        </div>
      </header>

      {/* MAIN LAYOUT */}
      <main className="flex-1 relative flex">
        
        <div className="flex-1 relative bg-black overflow-hidden group">
            <ReflexMirror 
                onZoneChange={(zone, angle, vel, snap) => {
                    sendVisualAlert(snap, `Alert: ${zone} Zone, Angle: ${angle.toFixed(1)}, Speed: ${vel.toFixed(1)}`);
                    
                    // Capture the FIRST failure snapshot of the trial for evidence
                    if (zone === SafetyZone.RED && !currentTrial.current.failSnapshot) {
                        currentTrial.current.failSnapshot = snap;
                        currentTrial.current.fail = true;
                    }
                }}
                onCalibrate={performCalibration}
                poseState={poseState}
                isLoading={isLoading}
                onVideoMount={setVideoElement}
                onShowGuide={() => {}}
                sessionPhase={phase}
                attemptCount={history.length}
                error={null}
                activeSide={activeSide}
            />

            {/* HANDS-FREE START UI */}
            {showAutoStart && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in">
                    <div className="flex flex-col items-center">
                        <svg className="w-32 h-32 transform -rotate-90">
                            <circle cx="64" cy="64" r="60" stroke="#334155" strokeWidth="8" fill="none" />
                            <circle cx="64" cy="64" r="60" stroke="#2dd4bf" strokeWidth="8" fill="none" strokeDasharray="377" strokeDashoffset={377 - (377 * poseState.gestureProgress) / 100} />
                        </svg>
                        <p className="mt-4 text-xl font-bold text-white tracking-widest">
                            {poseState.detectedStartSide ? `STARTING ${poseState.detectedStartSide}...` : "RAISE HAND TO START"}
                        </p>
                    </div>
                </div>
            )}

            {/* CLINICAL STATUS BANNER */}
            {phase === SessionPhase.GAME && (
                <div className="absolute top-20 left-1/2 transform -translate-x-1/2 bg-slate-900/90 border border-slate-700 backdrop-blur-md px-6 py-3 rounded-full shadow-2xl z-40 flex items-center gap-4">
                    <div className="flex flex-col items-center">
                        <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Status</span>
                        <span className={`text-lg font-bold ${
                            trialPhase === 'REACHING' ? 'text-teal-400' : 
                            trialPhase === 'RETURNING' ? 'text-yellow-400' : 'text-slate-200'
                        }`}>
                            {trialPhase === 'IDLE' ? 'READY' : trialPhase}
                        </span>
                    </div>
                    <div className="w-px h-8 bg-slate-700"></div>
                    <div className="flex flex-col items-center">
                         <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Trial</span>
                         <span className="text-lg font-bold text-white">
                            {Math.min(5, history.length + 1)} / 5
                         </span>
                    </div>
                </div>
            )}
        </div>

        {/* SIDEBAR */}
        <div className="w-80 border-l border-slate-800 bg-slate-900/80 backdrop-blur-md flex flex-col">
            <CoachPanel 
                isConnected={isConnected}
                angle={poseState.angle}
                zone={poseState.zone}
                fmaScore={Math.round(poseState.kpiScore)} 
                smoothness={poseState.velocity}
                messages={messages}
            />
            
            <div className="p-6 border-t border-slate-800 space-y-4">
                {phase === SessionPhase.GAME && (
                    <button 
                        onClick={() => setPhase(SessionPhase.SUMMARY)}
                        className="w-full py-4 bg-red-900/50 hover:bg-red-900 text-red-200 border border-red-800/50 rounded-xl font-bold flex items-center justify-center gap-2 transition-all"
                    >
                        <Square className="w-5 h-5 fill-current" />
                        ABORT TEST
                    </button>
                )}

                {phase === SessionPhase.LOBBY && (
                    <div className="space-y-4">
                        <div className="flex bg-slate-800 p-1 rounded-xl">
                            <button onClick={() => setActiveSide('LEFT')} className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${activeSide === 'LEFT' ? 'bg-teal-600 text-white' : 'text-slate-400'}`}>LEFT ARM</button>
                            <button onClick={() => setActiveSide('RIGHT')} className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${activeSide === 'RIGHT' ? 'bg-teal-600 text-white' : 'text-slate-400'}`}>RIGHT ARM</button>
                        </div>
                        <button 
                            onClick={() => setPhase(SessionPhase.CALIBRATION)}
                            className="w-full py-4 bg-teal-600 hover:bg-teal-500 text-white rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg shadow-teal-900/50 transition-all"
                        >
                            <Crosshair className="w-5 h-5" />
                            START PROTOCOL
                        </button>
                    </div>
                )}

                {phase === SessionPhase.CALIBRATION && (
                    <div className="space-y-4 text-center animate-in fade-in">
                        {poseState.isCalibrated ? (
                            <div className="p-4 bg-green-500/20 text-green-400 rounded-xl font-bold border border-green-500/50 animate-pulse">
                                CALIBRATED
                                <p className="text-xs opacity-70 mt-1 font-normal">Beginning Assessment...</p>
                            </div>
                        ) : (
                            <div className="flex gap-2">
                                <button onClick={performCalibration} className="flex-1 py-4 bg-slate-700 hover:bg-slate-600 text-white rounded-xl font-bold flex items-center justify-center gap-2">
                                    <Repeat className="w-4 h-4" /> RETRY
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
      </main>

      {/* SUMMARY REPORT */}
      {phase === SessionPhase.SUMMARY && (
          <ReportCard metrics={history} onRestart={() => setPhase(SessionPhase.LOBBY)} />
      )}
    </div>
  );
}

export default App;