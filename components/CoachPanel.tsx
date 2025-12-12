
import React from 'react';
import { SafetyZone } from '../types';
import { Activity, Cpu, Wifi, WifiOff, HeartPulse, BrainCircuit } from 'lucide-react';

interface CoachPanelProps {
  isConnected: boolean;
  angle: number;
  zone: SafetyZone;
  fmaScore: number; // Mapped to KPI in App.tsx
  smoothness: number;
  messages: Array<{role: 'user' | 'model', text: string}>;
}

export const CoachPanel: React.FC<CoachPanelProps> = ({ isConnected, angle, zone, fmaScore, smoothness, messages }) => {
  
  const gaugePercent = Math.min(100, Math.max(0, (angle / 30) * 100));
  
  // KPI Color Coding
  const kpiColor = fmaScore > 75 ? 'text-emerald-500' : fmaScore > 50 ? 'text-yellow-500' : 'text-rose-500';
  const smoothColor = smoothness > -8 ? 'text-emerald-500' : smoothness > -12 ? 'text-yellow-500' : 'text-rose-500';

  return (
    <div className="flex flex-col h-full bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
      
      {/* Header */}
      <div className="p-6 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
        <div>
            <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                <Cpu className="w-6 h-6 text-indigo-600" />
                NeuroBot
            </h2>
            <p className="text-xs text-slate-500 font-medium">Bio-Digital Twin Engine</p>
        </div>
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold ${isConnected ? 'bg-green-100 text-green-700' : 'bg-slate-200 text-slate-500'}`}>
            {isConnected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            {isConnected ? 'LIVE' : 'OFFLINE'}
        </div>
      </div>

      {/* Primary Telemetry */}
      <div className="p-6 flex flex-col items-center justify-center border-b border-slate-100 relative">
        <div className="absolute top-4 left-4 text-xs font-bold text-slate-400">TRUNK KINEMATICS</div>
        <div className="relative w-48 h-24 overflow-hidden mb-4 mt-2">
            <div className="absolute bottom-0 w-full h-full bg-slate-200 rounded-t-full"></div>
            <div 
                className={`absolute bottom-0 left-0 w-full h-full origin-bottom transform transition-transform duration-300 rounded-t-full ${
                    zone === SafetyZone.GREEN ? 'bg-teal-400' :
                    zone === SafetyZone.YELLOW ? 'bg-yellow-400' : 'bg-red-500'
                }`}
                style={{ transform: `rotate(${gaugePercent * 1.8 - 180}deg)` }}
            ></div>
             <div className="absolute bottom-0 left-1/2 transform -translate-x-1/2 w-36 h-18 bg-white rounded-t-full"></div>
        </div>
        <div className="text-center -mt-4">
            <span className="text-4xl font-bold text-slate-800">{Math.round(angle)}°</span>
            <span className="block text-xs uppercase tracking-wider text-slate-400 mt-1">Lean Angle</span>
        </div>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 border-b border-slate-100 divide-x divide-slate-100">
          <div className="p-4 flex flex-col items-center">
              <div className="flex items-center gap-2 mb-1">
                  <HeartPulse className="w-4 h-4 text-slate-400" />
                  <span className="text-xs font-bold text-slate-500 uppercase">KPI Score</span>
              </div>
              <span className={`text-2xl font-mono font-bold ${kpiColor}`}>
                  {fmaScore}/100
              </span>
              <span className="text-[10px] text-slate-400">Performance Index</span>
          </div>
          <div className="p-4 flex flex-col items-center">
              <div className="flex items-center gap-2 mb-1">
                  <BrainCircuit className="w-4 h-4 text-slate-400" />
                  <span className="text-xs font-bold text-slate-500 uppercase">Smoothness</span>
              </div>
              <span className={`text-2xl font-mono font-bold ${smoothColor}`}>
                  {smoothness.toFixed(1)}
              </span>
              <span className="text-[10px] text-slate-400">Log Dimensionless Jerk</span>
          </div>
      </div>

      {/* Live Log */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/50">
        {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm shadow-sm ${
                    msg.role === 'user' 
                    ? 'bg-slate-200 text-slate-700 rounded-tr-none' 
                    : 'bg-indigo-600 text-white rounded-tl-none'
                }`}>
                    {msg.text}
                </div>
            </div>
        ))}
      </div>
    </div>
  );
};
