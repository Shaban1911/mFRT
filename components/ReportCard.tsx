
import React, { useEffect, useState } from 'react';
import { AttemptMetric } from '../types';
import { Activity, Download, RefreshCw, Trophy, Beaker, ClipboardCheck, Sparkles, AlertTriangle } from 'lucide-react';
import { GoogleGenAI } from "@google/genai";

interface ReportCardProps {
  metrics: AttemptMetric[];
  onRestart: () => void;
}

export const ReportCard: React.FC<ReportCardProps> = ({ metrics, onRestart }) => {
  // mFRT Protocol: 2 Practice + 3 Test
  // We only score the Test trials (Attempt 3, 4, 5)
  const isProtocolValid = metrics.length >= 3;
  
  const testTrials = isProtocolValid ? metrics.slice(2) : metrics;
  const practiceTrials = isProtocolValid ? metrics.slice(0, 2) : [];
  
  const avgReach = testTrials.length > 0 
    ? testTrials.reduce((acc, m) => acc + m.maxReachCm, 0) / testTrials.length 
    : 0;
    
  const avgKPI = testTrials.length > 0
    ? testTrials.reduce((acc, m) => acc + m.clinicalScore, 0) / testTrials.length
    : 0;

  const maxVelocity = Math.max(...metrics.map(m => m.maxVelocity));
  const riskScore = avgReach < 15 ? 'HIGH' : avgReach < 25 ? 'MODERATE' : 'LOW';

  const [clinicalNote, setClinicalNote] = useState<string>('');
  const [loadingNote, setLoadingNote] = useState(false);

  useEffect(() => {
    const generateNote = async () => {
        if (!process.env.API_KEY || !isProtocolValid) return;
        setLoadingNote(true);
        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            const response = await ai.models.generateContent({
                model: 'gemini-3-pro-preview',
                contents: `Analyze this rehab session: ${JSON.stringify(metrics)}. Generate a concise professional S.O.A.P. Note (Subjective, Objective, Assessment, Plan) for a physiotherapist. Identify compensatory patterns.`
            });
            setClinicalNote(response.text || "Analysis failed.");
        } catch (e) {
            console.error(e);
            setClinicalNote("Could not generate clinical note.");
        }
        setLoadingNote(false);
    };
    generateNote();
  }, [metrics, isProtocolValid]);
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/95 backdrop-blur-md p-4 animate-in zoom-in-95">
      <div className="bg-white w-full max-w-4xl rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        <div className="p-6 bg-indigo-600 text-white text-center shrink-0">
            <Trophy className="w-12 h-12 mx-auto mb-2 text-yellow-300" />
            <h2 className="text-2xl font-bold">Session Complete</h2>
            <p className="opacity-80 text-sm">Modified Functional Reach Test (mFRT)</p>
            {!isProtocolValid && (
                <span className="inline-block mt-2 px-3 py-1 bg-indigo-800 rounded-full text-xs font-bold text-indigo-200 border border-indigo-700">
                    PRELIMINARY DATA (Under 3 Trials)
                </span>
            )}
        </div>

        <div className="flex flex-1 overflow-hidden">
            {/* LEFT COLUMN: STATS */}
            <div className="w-1/2 p-6 space-y-6 overflow-y-auto border-r border-slate-100">
                <div className="grid grid-cols-2 gap-4">
                    <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 text-center">
                        <p className="text-xs text-slate-500 uppercase font-bold tracking-wider">Fall Risk</p>
                        <p className={`text-xl font-bold ${
                            riskScore === 'HIGH' ? 'text-red-600' : 
                            riskScore === 'MODERATE' ? 'text-yellow-600' : 'text-green-600'
                        }`}>{riskScore}</p>
                    </div>
                    <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 text-center">
                        <p className="text-xs text-slate-500 uppercase font-bold tracking-wider">Clinical Average</p>
                        <p className="text-xl font-bold text-slate-900">{avgReach.toFixed(1)} cm</p>
                        <p className="text-[10px] text-slate-400">Based on Test Trials</p>
                    </div>
                </div>

                <div className="space-y-3">
                    <h3 className="font-bold text-slate-900 flex items-center gap-2 text-sm">
                        <Activity className="w-4 h-4" /> Trial Breakdown
                    </h3>
                    
                    {/* Practice Trials */}
                    {practiceTrials.map((m, i) => (
                        <div key={`prac-${i}`} className="flex justify-between items-center p-3 bg-slate-50 border border-dashed border-slate-300 rounded-xl text-sm opacity-70 grayscale">
                             <div className="flex items-center gap-2">
                                <Beaker className="w-4 h-4 text-slate-400" />
                                <span className="font-medium text-slate-500">Practice {i + 1}</span>
                             </div>
                            <div className="flex gap-4 text-slate-400">
                                <span>Reach: {m.maxReachCm.toFixed(1)}cm</span>
                            </div>
                        </div>
                    ))}

                    {/* Test Trials */}
                    {testTrials.map((m, i) => (
                        <div key={`test-${i}`} className="flex justify-between items-center p-3 bg-white border border-slate-200 rounded-xl text-sm shadow-sm relative overflow-hidden">
                            <div className="flex items-center gap-2 relative z-10">
                                <ClipboardCheck className="w-4 h-4 text-indigo-500" />
                                <span className="font-bold text-slate-700">Test Trial {i + 1}</span>
                            </div>
                            <div className="flex items-center gap-4 relative z-10">
                                {m.failureSnapshot && (
                                    <div className="relative group">
                                        <img src={m.failureSnapshot} alt="Fail" className="w-10 h-10 rounded object-cover border-2 border-red-500" />
                                        <div className="absolute top-0 right-0 -mt-1 -mr-1 w-3 h-3 bg-red-500 rounded-full"></div>
                                    </div>
                                )}
                                <span className="text-slate-600 font-mono">
                                    <b>{m.maxReachCm.toFixed(1)}</b> cm
                                </span>
                                <span className={m.triggeredFail ? "text-red-500 font-bold" : "text-emerald-600 font-bold"}>
                                    KPI: {m.clinicalScore}
                                </span>
                            </div>
                        </div>
                    ))}
                </div>

                <div className="bg-yellow-50 p-3 rounded-xl border border-yellow-100 text-xs text-yellow-800 leading-relaxed">
                    <strong>Rule-Based Analysis:</strong> 
                    {maxVelocity > 50 
                        ? " High velocity movements detected (>50°/s). Recommend checking for ballistic compensatory strategies." 
                        : " Movements were controlled within safe velocity limits."}
                    {metrics.some(m => m.triggeredFail) && " Compensation events (Butt Lift/Rotation) were detected in some trials."}
                </div>
            </div>

            {/* RIGHT COLUMN: AI ANALYSIS */}
            <div className="w-1/2 bg-slate-50 p-6 flex flex-col border-l border-slate-200">
                <div className="flex items-center gap-2 mb-4">
                    <Sparkles className="w-5 h-5 text-indigo-600" />
                    <h3 className="font-bold text-slate-900">Gemini 3.0 Clinical Analysis</h3>
                </div>

                <div className="flex-1 bg-white rounded-2xl border border-slate-200 p-4 shadow-inner overflow-y-auto text-sm leading-relaxed text-slate-700 font-mono">
                    {loadingNote ? (
                         <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-3">
                             <div className="animate-spin w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full"></div>
                             <p className="animate-pulse">Reasoning about biomechanics...</p>
                         </div>
                    ) : (
                        <div className="whitespace-pre-wrap">{clinicalNote}</div>
                    )}
                </div>
                
                <div className="mt-4 p-3 bg-indigo-50 text-indigo-700 text-xs rounded-xl flex gap-2 items-start">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <p>AI-generated content for informational purposes only. Review with a licensed clinician before adding to EMR.</p>
                </div>
            </div>
        </div>

        <div className="p-4 bg-slate-50 border-t border-slate-100 flex gap-4 shrink-0">
            <button 
                onClick={onRestart}
                className="flex-1 py-3 bg-white border border-slate-300 text-slate-700 rounded-xl font-bold hover:bg-slate-100 transition-colors flex items-center justify-center gap-2"
            >
                <RefreshCw className="w-4 h-4" /> New Patient
            </button>
            <button className="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2 shadow-lg shadow-indigo-200">
                <Download className="w-4 h-4" /> Export EMR
            </button>
        </div>
      </div>
    </div>
  );
};