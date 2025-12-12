
import React, { useEffect, useState } from 'react';
import { AttemptMetric } from '../types';
import { Activity, Download, RefreshCw, Trophy, Beaker, ClipboardCheck, Sparkles, AlertTriangle, Stethoscope, Dumbbell } from 'lucide-react';
import { GoogleGenAI, Type, Schema } from "@google/genai";

interface ReportCardProps {
  metrics: AttemptMetric[];
  onRestart: () => void;
}

// Define the structure of our AI Doctor's output
interface AIAnalysis {
    soap_note: string;
    prescription: Array<{
        name: string;
        description: string;
        frequency: string;
    }>;
}

export const ReportCard: React.FC<ReportCardProps> = ({ metrics, onRestart }) => {
  // mFRT Protocol: 2 Practice + 3 Test
  const isProtocolValid = metrics.length >= 3;
  
  const testTrials = isProtocolValid ? metrics.slice(2) : metrics;
  const practiceTrials = isProtocolValid ? metrics.slice(0, 2) : [];
  
  const avgReach = testTrials.length > 0 
    ? testTrials.reduce((acc, m) => acc + m.maxReachCm, 0) / testTrials.length 
    : 0;
    
  const maxVelocity = Math.max(...metrics.map(m => m.maxVelocity));
  const riskScore = avgReach < 15 ? 'HIGH' : avgReach < 25 ? 'MODERATE' : 'LOW';

  const [analysis, setAnalysis] = useState<AIAnalysis | null>(null);
  const [loadingNote, setLoadingNote] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const generateAnalysis = async () => {
        if (!process.env.API_KEY || !isProtocolValid) return;
        setLoadingNote(true);
        setError(null);

        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            
            // 1. Prepare Multimodal Payload
            const parts: any[] = [];
            
            // Context Prompt
            const promptText = `
            ROLE: Senior Stroke Rehabilitation Physiotherapist (Gemini 3.0 Powered).
            TASK: Analyze the Modified Functional Reach Test (mFRT) data and IMAGES of failure points.
            
            DATA:
            - Average Reach: ${avgReach.toFixed(1)} cm
            - Fall Risk Category: ${riskScore}
            - Max Velocity: ${maxVelocity.toFixed(1)} deg/s (Ballistic check)
            
            INSTRUCTIONS:
            1. Look at the attached images (failure snapshots). Identify biomechanical compensations (e.g., trunk rotation, hip hiking, scapular winging).
            2. Generate a professional S.O.A.P. Note.
            3. Prescribe exactly 3 specific corrective home exercises based on the observed failures.
            `;
            parts.push({ text: promptText });

            // Attach Images (Base64) - Robust Hygiene Check
            metrics.forEach((m, i) => {
                if (m.failureSnapshot && typeof m.failureSnapshot === 'string') {
                    // Critical Safety: Check for valid base64 header before splitting
                    if (m.failureSnapshot.includes('base64,')) {
                        const splitData = m.failureSnapshot.split(',');
                        if (splitData.length > 1) {
                            const base64Data = splitData[1];
                            if (base64Data) {
                                parts.push({ 
                                    text: `[Trial ${i+1} Failure Snapshot - Analyze This Form]:` 
                                });
                                parts.push({
                                    inlineData: {
                                        mimeType: 'image/jpeg',
                                        data: base64Data
                                    }
                                });
                            }
                        }
                    }
                }
            });

            // 2. Define Strict JSON Schema for Gemini 3.0
            const responseSchema: Schema = {
                type: Type.OBJECT,
                properties: {
                    soap_note: { 
                        type: Type.STRING, 
                        description: "A professional Subjective, Objective, Assessment, Plan note." 
                    },
                    prescription: {
                        type: Type.ARRAY,
                        description: "List of 3 corrective exercises.",
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                name: { type: Type.STRING },
                                description: { type: Type.STRING },
                                frequency: { type: Type.STRING }
                            }
                        }
                    }
                },
                required: ["soap_note", "prescription"]
            };

            // 3. Network Safety Layer (20s Timeout)
            const timeoutMs = 20000;
            const timeoutPromise = new Promise<never>((_, reject) => 
                setTimeout(() => reject(new Error("Gemini 3.0 Request Timed Out")), timeoutMs)
            );

            // 4. API Call - Using Gemini 3.0 Pro Preview
            const generatePromise = ai.models.generateContent({
                model: 'gemini-3.0-pro-preview', // Explicitly using the requested Gemini 3.0 identifier
                contents: { parts },
                config: {
                    responseMimeType: 'application/json',
                    responseSchema: responseSchema,
                    temperature: 0.2, // Low temp for clinical accuracy
                }
            });

            // Race the API against the clock
            // @ts-ignore: Promise.race type inference is safe here
            const response = await Promise.race([generatePromise, timeoutPromise]);

            // 5. Parse Response
            const text = response.text;
            
            if (text) {
                try {
                    const parsed = JSON.parse(text);
                    setAnalysis(parsed);
                } catch (parseError) {
                    console.error("JSON Parse Error:", parseError, text);
                    throw new Error("Failed to parse clinical report format.");
                }
            } else {
                throw new Error("Empty response from AI Engine.");
            }

        } catch (e: any) {
            console.error("Gemini 3.0 Analysis Error:", e);
            // Show specific error to user for better debugging/feedback
            setError(e.message || "Clinical Analysis Service Unavailable");
        }
        setLoadingNote(false);
    };

    generateAnalysis();
  }, [metrics, isProtocolValid, avgReach, riskScore, maxVelocity]);
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/95 backdrop-blur-md p-4 animate-in zoom-in-95">
      <div className="bg-white w-full max-w-5xl rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
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
            {/* LEFT COLUMN: STATS & TRIALS */}
            <div className="w-5/12 p-6 space-y-6 overflow-y-auto border-r border-slate-100 bg-slate-50/50">
                <div className="grid grid-cols-2 gap-4">
                    <div className="bg-white p-4 rounded-2xl border border-slate-200 text-center shadow-sm">
                        <p className="text-xs text-slate-500 uppercase font-bold tracking-wider">Fall Risk</p>
                        <p className={`text-xl font-bold ${
                            riskScore === 'HIGH' ? 'text-red-600' : 
                            riskScore === 'MODERATE' ? 'text-yellow-600' : 'text-green-600'
                        }`}>{riskScore}</p>
                    </div>
                    <div className="bg-white p-4 rounded-2xl border border-slate-200 text-center shadow-sm">
                        <p className="text-xs text-slate-500 uppercase font-bold tracking-wider">Clinical Avg</p>
                        <p className="text-xl font-bold text-slate-900">{avgReach.toFixed(1)} cm</p>
                    </div>
                </div>

                <div className="space-y-3">
                    <h3 className="font-bold text-slate-900 flex items-center gap-2 text-sm">
                        <Activity className="w-4 h-4" /> Data Stream
                    </h3>
                    
                    {practiceTrials.map((m, i) => (
                        <div key={`prac-${i}`} className="flex justify-between items-center p-3 bg-slate-100 border border-dashed border-slate-300 rounded-xl text-xs opacity-60">
                             <div className="flex items-center gap-2">
                                <Beaker className="w-3 h-3 text-slate-400" />
                                <span className="font-medium text-slate-500">Practice {i + 1}</span>
                             </div>
                            <span>{m.maxReachCm.toFixed(1)} cm</span>
                        </div>
                    ))}

                    {testTrials.map((m, i) => (
                        <div key={`test-${i}`} className="flex justify-between items-center p-3 bg-white border border-slate-200 rounded-xl text-sm shadow-sm">
                            <div className="flex items-center gap-2">
                                <ClipboardCheck className="w-4 h-4 text-indigo-500" />
                                <span className="font-bold text-slate-700">Test {i + 1}</span>
                            </div>
                            <div className="flex items-center gap-3">
                                {m.failureSnapshot && (
                                    <div className="relative group cursor-help">
                                        <img src={m.failureSnapshot} alt="Fail" className="w-8 h-8 rounded object-cover border border-red-300" />
                                        <div className="absolute top-0 right-0 w-2 h-2 bg-red-500 rounded-full animate-ping"></div>
                                    </div>
                                )}
                                <span className="font-mono font-bold text-slate-800">{m.maxReachCm.toFixed(1)} cm</span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* RIGHT COLUMN: AI ANALYSIS (SOAP + PRESCRIPTION) */}
            <div className="w-7/12 bg-white p-6 flex flex-col overflow-y-auto">
                <div className="flex items-center gap-2 mb-4 text-indigo-700">
                    <Sparkles className="w-5 h-5" />
                    <h3 className="font-bold">Gemini 3.0 Clinical Analysis</h3>
                </div>

                {loadingNote && (
                     <div className="flex-1 flex flex-col items-center justify-center text-slate-400 gap-4">
                         <div className="animate-spin w-10 h-10 border-4 border-indigo-100 border-t-indigo-600 rounded-full"></div>
                         <div className="text-center">
                             <p className="font-medium text-indigo-900">Consulting Gemini 3.0...</p>
                             <p className="text-xs">Processing multimodal biomechanics ({metrics.filter(m => m.failureSnapshot).length} images)</p>
                         </div>
                     </div>
                )}

                {error && (
                    <div className="p-4 bg-red-50 text-red-600 rounded-xl text-sm border border-red-100 flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4" />
                        <div>
                            <p className="font-bold">Analysis Failed</p>
                            <p className="text-xs opacity-80">{error}</p>
                        </div>
                    </div>
                )}

                {analysis && !loadingNote && (
                    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
                        
                        {/* SOAP NOTE */}
                        <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                            <div className="flex items-center gap-2 mb-2 text-slate-500 text-xs font-bold uppercase tracking-wider">
                                <Stethoscope className="w-3 h-3" /> S.O.A.P Note
                            </div>
                            <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed font-mono">
                                {analysis.soap_note}
                            </p>
                        </div>

                        {/* PRESCRIPTION ENGINE */}
                        <div>
                            <div className="flex items-center gap-2 mb-3 text-teal-700">
                                <Dumbbell className="w-5 h-5" />
                                <h3 className="font-bold">AI Prescribed Remedial Plan</h3>
                            </div>
                            <div className="grid grid-cols-1 gap-3">
                                {analysis.prescription.map((ex, i) => (
                                    <div key={i} className="p-4 rounded-xl border border-teal-100 bg-teal-50/50 hover:bg-teal-50 transition-colors">
                                        <div className="flex justify-between items-start mb-1">
                                            <h4 className="font-bold text-teal-900">{ex.name}</h4>
                                            <span className="text-xs font-bold bg-teal-100 text-teal-700 px-2 py-0.5 rounded">
                                                {ex.frequency}
                                            </span>
                                        </div>
                                        <p className="text-sm text-teal-800/80">{ex.description}</p>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="p-3 bg-indigo-50 text-indigo-700 text-xs rounded-xl flex gap-2 items-start border border-indigo-100">
                            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                            <p>This plan is generated by AI based on biomechanical data. Review with a licensed clinician before implementation.</p>
                        </div>
                    </div>
                )}
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
                <Download className="w-4 h-4" /> Export EMR (JSON)
            </button>
        </div>
      </div>
    </div>
  );
};
