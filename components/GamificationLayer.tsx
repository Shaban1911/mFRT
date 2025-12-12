
import React, { useEffect, useRef, useState } from 'react';
import { Target, Zap, Trophy } from 'lucide-react';
import { GameState, GameTarget, PoseState, POSE_LANDMARKS } from '../types';

interface GamificationLayerProps {
  poseState: PoseState;
  isPlaying: boolean;
  onScoreUpdate: (score: number) => void;
}

export const GamificationLayer: React.FC<GamificationLayerProps> = ({ poseState, isPlaying, onScoreUpdate }) => {
  const [gameState, setGameState] = useState<GameState>({
    score: 0,
    combo: 0,
    targets: [],
    isPlaying
  });
  
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Audio Synth (No external files)
  const playSound = (type: 'hit' | 'combo' | 'spawn') => {
    if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    const ctx = audioCtxRef.current;
    if (ctx.state === 'suspended') ctx.resume();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === 'hit') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
        osc.start();
        osc.stop(ctx.currentTime + 0.1);
    } else if (type === 'combo') {
        osc.type = 'square';
        osc.frequency.setValueAtTime(220, ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(880, ctx.currentTime + 0.2);
        gain.gain.setValueAtTime(0.05, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.3);
        osc.start();
        osc.stop(ctx.currentTime + 0.3);
    }
  };

  // Game Loop
  useEffect(() => {
    if (!isPlaying) return;

    const interval = setInterval(() => {
        setGameState(prev => {
            if (prev.targets.length >= 3) return prev;
            
            // Spawn target in "Reachable" 2D space (Top-Left to Top-Right arc)
            const newTarget: GameTarget = {
                id: Date.now(),
                x: 0.2 + Math.random() * 0.6, // 20% to 80% width
                y: 0.3 + Math.random() * 0.3, // 30% to 60% height
                size: 60,
                hit: false,
                spawnTime: Date.now()
            };
            // playSound('spawn');
            return { ...prev, targets: [...prev.targets, newTarget] };
        });
    }, 2000); // New target every 2s

    return () => clearInterval(interval);
  }, [isPlaying]);

  // Collision Detection
  useEffect(() => {
    if (!poseState.landmarks || !isPlaying) return;
    
    const hand = poseState.landmarks[POSE_LANDMARKS.LEFT_INDEX];
    if (!hand || hand.visibility! < 0.5) return;

    // Hand coordinates (0-1) need to be flipped horizontally if mirrored, 
    // but usually MediaPipe renders mirrored. Let's assume consistent mapping.
    // Screen is 1.0 x 1.0. Hand x is normalized.
    
    setGameState(prev => {
        const hitTargets = prev.targets.filter(t => !t.hit && 
            Math.abs(t.x - hand.x) < 0.08 && // Approx 8% screen width tolerance
            Math.abs(t.y - hand.y) < 0.08
        );

        if (hitTargets.length > 0) {
            playSound(prev.combo > 2 ? 'combo' : 'hit');
            const newScore = prev.score + (100 * (prev.combo + 1));
            onScoreUpdate(newScore);
            return {
                ...prev,
                score: newScore,
                combo: prev.combo + 1,
                targets: prev.targets.filter(t => !hitTargets.includes(t))
            };
        }
        return prev;
    });
  }, [poseState.landmarks, isPlaying, onScoreUpdate]);

  if (!isPlaying) return null;

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {/* Score HUD */}
      <div className="absolute top-4 left-4 flex flex-col gap-2 animate-in slide-in-from-top">
        <div className="bg-slate-900/90 border border-teal-500/30 backdrop-blur-md p-4 rounded-xl shadow-[0_0_20px_rgba(45,212,191,0.2)]">
            <div className="flex items-center gap-2 text-teal-400 font-mono text-sm mb-1">
                <Trophy className="w-4 h-4" /> SCORE
            </div>
            <div className="text-4xl font-black text-white tracking-tighter tabular-nums">
                {gameState.score.toLocaleString()}
            </div>
        </div>
        
        {gameState.combo > 1 && (
            <div className="bg-fuchsia-600/90 backdrop-blur-md px-4 py-2 rounded-xl border border-fuchsia-400 text-white font-black text-xl italic shadow-lg animate-bounce">
                {gameState.combo}x COMBO!
            </div>
        )}
      </div>

      {/* Targets */}
      {gameState.targets.map(target => (
        <div
            key={target.id}
            className="absolute flex items-center justify-center animate-in zoom-in spin-in-3"
            style={{
                left: `${target.x * 100}%`,
                top: `${target.y * 100}%`,
                width: target.size,
                height: target.size,
                transform: 'translate(-50%, -50%)'
            }}
        >
            <div className="absolute inset-0 border-2 border-teal-400 rounded-full animate-ping opacity-50"></div>
            <div className="absolute inset-0 border-2 border-teal-400 rounded-full shadow-[0_0_15px_rgba(45,212,191,0.8)] bg-teal-900/40 backdrop-blur-sm flex items-center justify-center">
                <Target className="w-6 h-6 text-teal-200" />
            </div>
        </div>
      ))}
      
      {/* Hand Cursor (Optional, helps aiming) */}
      {poseState.landmarks && (
          <div 
            className="absolute w-8 h-8 border-2 border-fuchsia-500 rounded-full shadow-[0_0_20px_rgba(232,121,249,0.8)] transition-all duration-75"
            style={{
                left: `${poseState.landmarks[POSE_LANDMARKS.LEFT_INDEX].x * 100}%`,
                top: `${poseState.landmarks[POSE_LANDMARKS.LEFT_INDEX].y * 100}%`,
                transform: 'translate(-50%, -50%)'
            }}
          >
              <div className="absolute inset-0 bg-fuchsia-500/20 rounded-full animate-pulse"></div>
          </div>
      )}
    </div>
  );
};
