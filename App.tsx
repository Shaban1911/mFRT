
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { ReflexMirror } from './components/ReflexMirror';
import { CoachPanel } from './components/CoachPanel';
import { ReportCard } from './components/ReportCard';
import { usePoseEstimation } from './hooks/usePoseEstimation';
import { useGeminiLive } from './hooks/useGeminiLive';
import { SafetyZone, SessionPhase, AttemptMetric } from './types';
import { Crosshair, Mic, Square, Power, Activity, Ruler, Scaling } from 'lucide-react';

// Trial State Machine
type TrialPhase = 'IDLE' | 'REACHING' | 'RETURNING' | 'COOLDOWN';

function App() {
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);
  const [phase, setPhase] = useState<SessionPhase>(SessionPhase.LOBBY);
  const [activeSide, setActiveSide] = useState<'LEFT' | 'RIGHT'>('LEFT');
  const [isSystemInitialized, setIsSystemInitialized] = useState(false);
  
  // Anthropometry
  const [patientHeight, setPatientHeight] = useState<number>(170);
  const [patientArmLength, setPatientArmLength] = useState<number>(75);

  // Calibration Countdown State
  const [countdown, setCountdown] = useState<number | null>(null);

  // Clinical Protocol State
  const [history, setHistory] = useState<AttemptMetric[]>([]);
  const [trialPhase, setTrialPhase] = useState<TrialPhase>('IDLE');
  const [cooldownTimer, setCooldownTimer] = useState(0);
  
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

  const startCountdownProtocol = useCallback(() => {
      setCountdown(5);
      speak("Sit back. Feet flat. Arms at ninety degrees.");
  }, []);

  const performStartGame = useCallback(() => {
      setPhase(SessionPhase.GAME);
      setHistory([]);
      setTrialPhase('IDLE');
  }, []);

  const { poseState, calibrate, isLoading } = usePoseEstimation(videoElement, activeSide, performCalibration);
  
  const { isConnected, connect, sendVisualAlert, messages, resumeAudio, volume } = useGeminiLive({
      onCalibrationCmd: startCountdownProtocol, // Voice command triggers countdown first
      onStartGameCmd: performStartGame
  });

  // 1. SYSTEM INIT
  const handleSystemInit = async () => {
      await resumeAudio();
      connect();
      setIsSystemInitialized(true);
  };

  // 2. COUNTDOWN LOGIC (THE FORCE-LOCK TRIGGER)
  useEffect(() => {
      if (countdown === null) return;

      if (countdown > 0) {
          const timer = setTimeout(() => setCountdown(c => c !== null ? c - 1 : null), 1000);
          return () => clearTimeout(timer);
      } else {
          // Countdown finished -> Trigger Actual Calibration (Force Lock)
          setCountdown(null);
          // FUSION CALIBRATION: Pass both Height and Arm Length
          calibrate({ height: patientHeight, armLength: patientArmLength }); 
      }
  }, [countdown, calibrate, patientHeight, patientArmLength]); 

  // 3. CALIBRATION -> GAME TRANSITION (Instant)
  useEffect(() => {
      // As soon as the worker reports calibration is locked, we switch to GAME.
      if (phase === SessionPhase.CALIBRATION && poseState.isCalibrated) {
          setPhase(SessionPhase.GAME);
          setTrialPhase('IDLE');
          setHistory([]);
          speak("Go! Reach forward.");
      }
  }, [phase, poseState.isCalibrated]);

  // 4. CLINICAL TRIAL STATE MACHINE
  useEffect(() => {
      if (phase !== SessionPhase.GAME) return;

      const now = Date.now();
      const reach = poseState.estimatedReachCm;
      const vel = poseState.velocity;
      const angle = poseState.angle;
      const isRed = poseState.zone === SafetyZone.RED;
      const enginePhase = poseState.internalPhase; // Uses worker state

      // Update Peak Values
      if (trialPhase === 'REACHING' || trialPhase === 'RETURNING') {
          currentTrial.current.maxReach = Math.max(currentTrial.current.maxReach, reach);
          currentTrial.current.maxVel = Math.max(currentTrial.current.maxVel, vel);
          currentTrial.current.maxAngle = Math.max(currentTrial.current.maxAngle, angle);
          currentTrial.current.maxScore = Math.max(currentTrial.current.maxScore, poseState.kpiScore);
          if (isRed) currentTrial.current.fail = true;
      }

      switch (trialPhase) {
          case 'IDLE':
              // SYNC with Worker's Phase Detection
              if (enginePhase === 'REACHING') {
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
              // B. Worker signals completion or return
              if (enginePhase === 'RETURNING' || enginePhase === 'COMPLETED' || enginePhase === 'LOCKED') {
                  setTrialPhase('RETURNING');
              }
              break;

          case 'RETURNING':
              // End Trigger: Worker goes back to LOCKED or UNSTABLE or Reach < 5cm
              if (reach < 5.0 || enginePhase === 'LOCKED' || enginePhase === 'UNSTABLE') {
                  // FALSE START / JITTER LOGIC (< 5.0 cm MAX Reach)
                  if (currentTrial.current.maxReach < 5.0) {
                      setTrialPhase('IDLE');
                  } else {
                      // VALID TRIAL LOGGING
                      const newMetric: AttemptMetric = {
                          id: Date.now(),
                          maxReachCm: currentTrial.current.maxReach,
                          maxLeanAngle: currentTrial.current.maxAngle,
                          clinicalScore: currentTrial.current.maxScore,
                          maxVelocity: currentTrial.current.maxVel,
                          triggeredFail: currentTrial.current.fail,
                          failureSnapshot: currentTrial.current.failSnapshot
                      };
                      
                      setHistory(prev => {
                          const updated = [...prev, newMetric];
                          const val = currentTrial.current.maxReach;
                          if (val > 25) speak("Excellent reach!");
                          else if (val > 15) speak("Good stability.");
                          else speak("Rest now.");
                          return updated;
                      });
                      
                      currentTrial.current.failSnapshot = undefined;
                      setTrialPhase('COOLDOWN');
                      setCooldownTimer(5); // 5 Seconds Strict ATP-PC Recovery
                  }
              }
              break;

          case 'COOLDOWN':
              break;
      }
  }, [poseState, phase, trialPhase]);

  // Cooldown Timer
  useEffect(() => {
      if (trialPhase === 'COOLDOWN') {
          if (cooldownTimer > 0) {
              const t = setTimeout(() => setCooldownTimer(c => c - 1), 1000);
              return () => clearTimeout(t);
          } else {
              setTrialPhase('IDLE');
              speak("Ready.");
          }
      }
  }, [trialPhase, cooldownTimer]);

  // 5. PROTOCOL ENFORCEMENT (5 Trials -> Summary)
  useEffect(() => {
      if (phase === SessionPhase.GAME && history.length >= 5 && trialPhase === 'COOLDOWN' && cooldownTimer === 0) {
           setTimeout(() => {
               setPhase(SessionPhase.SUMMARY);
               speak("Session complete. Analyzing data.");
           }, 500);
      }
  }, [history.length, phase, trialPhase, cooldownTimer]);

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
                    
                    if (zone === SafetyZone.RED && !currentTrial.current.failSnapshot) {
                        currentTrial.current.failSnapshot = snap;
                        currentTrial.current.fail = true;
                    }
                }}
                onCalibrate={startCountdownProtocol}
                poseState={poseState}
                isLoading={isLoading}
                onVideoMount={setVideoElement}
                onShowGuide={() => {}}
                sessionPhase={phase}
                attemptCount={history.length}
                error={null}
                activeSide={activeSide}
            />

            {/* COUNTDOWN OVERLAY */}
            {countdown !== null && (
                <div className="absolute inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex flex-col items-center justify-center animate-in fade-in">
                    <div className="relative">
                        <div className="w-64 h-64 rounded-full border-8 border-slate-800 flex items-center justify-center bg-slate-900 shadow-2xl">
                            <span className="text-9xl font-black text-white tabular-nums tracking-tighter animate-pulse">
                                {countdown}
                            </span>
                        </div>
                        <div className="absolute top-0 left-0 w-full h-full border-8 border-teal-500 rounded-full animate-ping opacity-20"></div>
                    </div>
                    <div className="mt-12 text-center space-y-4">
                        <h2 className="text-4xl font-bold text-white tracking-tight">GET INTO POSITION</h2>
                        <div className="flex gap-8 text-xl font-medium text-teal-400">
                            <span className="flex items-center gap-2"><Square className="w-5 h-5 fill-current"/> SIT BACK</span>
                            <span className="flex items-center gap-2"><Square className="w-5 h-5 fill-current"/> FEET FLAT</span>
                            <span className="flex items-center gap-2"><Square className="w-5 h-5 fill-current"/> ARMS 90°</span>
                        </div>
                    </div>
                </div>
            )}

            {/* REST & RESET OVERLAY (COOLDOWN) */}
            {phase === SessionPhase.GAME && trialPhase === 'COOLDOWN' && (
                <div className="absolute inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex flex-col items-center justify-center animate-in fade-in">
                    <div className="flex flex-col items-center gap-4">
                        <div className="text-4xl font-black text-white tracking-widest">REST & RESET</div>
                        <div className="w-64 h-2 bg-slate-700 rounded-full overflow-hidden">
                            <div 
                                className="h-full bg-teal-500 transition-all duration-1000 ease-linear"
                                style={{ width: `${(cooldownTimer / 5) * 100}%` }}
                            ></div>
                        </div>
                        <div className="text-teal-400 font-mono text-xl">{cooldownTimer}s</div>
                    </div>
                </div>
            )}

            {/* READY / LOCKED STATE UI */}
            {phase === SessionPhase.GAME && trialPhase === 'IDLE' && poseState.isCalibrated && (
                <div className="absolute inset-0 z-40 flex items-center justify-center bg-transparent pointer-events-none">
                     <div className="flex flex-col items-center gap-2">
                        <div className="relative">
                             <div className="absolute inset-0 bg-teal-500/20 blur-xl rounded-full animate-pulse"></div>
                             <div className="bg-slate-900/90 border-2 border-teal-500 text-teal-400 px-8 py-4 rounded-2xl font-black text-2xl tracking-widest shadow-2xl backdrop-blur-md">
                                 REACH NOW!
                             </div>
                        </div>
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
                        {/* ANTHROPOMETRY INPUTS */}
                        <div className="bg-slate-800 p-4 rounded-xl space-y-4 border border-slate-700">
                             {/* Height Input */}
                             <div className="space-y-2">
                                 <div className="flex items-center gap-2 text-slate-400 mb-1">
                                    <Ruler className="w-4 h-4" />
                                    <span className="text-xs font-bold uppercase tracking-wider">Patient Height</span>
                                 </div>
                                 <div className="flex items-center gap-2">
                                     <input 
                                        type="number" 
                                        value={patientHeight}
                                        onChange={(e) => setPatientHeight(Number(e.target.value))}
                                        className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white font-mono font-bold text-lg focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                                        min="100"
                                        max="250"
                                     />
                                     <span className="text-slate-500 font-bold">cm</span>
                                 </div>
                             </div>

                             {/* Arm Length Input */}
                             <div className="space-y-2">
                                 <div className="flex items-center gap-2 text-slate-400 mb-1">
                                    <Scaling className="w-4 h-4" />
                                    <span className="text-xs font-bold uppercase tracking-wider">Arm Length</span>
                                 </div>
                                 <div className="flex items-center gap-2">
                                     <input 
                                        type="number" 
                                        value={patientArmLength}
                                        onChange={(e) => setPatientArmLength(Number(e.target.value))}
                                        className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white font-mono font-bold text-lg focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                                        min="40"
                                        max="100"
                                     />
                                     <span className="text-slate-500 font-bold">cm</span>
                                 </div>
                             </div>
                        </div>

                        <div className="flex bg-slate-800 p-1 rounded-xl">
                            <button onClick={() => setActiveSide('LEFT')} className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${activeSide === 'LEFT' ? 'bg-teal-600 text-white' : 'text-slate-400'}`}>LEFT ARM</button>
                            <button onClick={() => setActiveSide('RIGHT')} className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${activeSide === 'RIGHT' ? 'bg-teal-600 text-white' : 'text-slate-400'}`}>RIGHT ARM</button>
                        </div>
                        <button 
                            onClick={startCountdownProtocol}
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
                                <button className="flex-1 py-4 bg-slate-800 text-slate-400 rounded-xl font-bold flex items-center justify-center gap-2 cursor-wait">
                                    <Activity className="w-4 h-4 animate-spin" /> CALIBRATING...
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
