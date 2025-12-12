
import React from 'react';
import { Play, Check, X } from 'lucide-react';

interface ExerciseGuideProps {
  onStart: () => void;
}

export const ExerciseGuide: React.FC<ExerciseGuideProps> = ({ onStart }) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/90 backdrop-blur-sm animate-in fade-in">
      <div className="bg-white w-full max-w-4xl rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Medical Header */}
        <div className="bg-white border-b border-slate-100 p-8">
            <div className="flex items-center gap-3 mb-2">
                <span className="bg-indigo-100 text-indigo-700 px-3 py-1 rounded-full text-xs font-bold tracking-wider">CLINICAL PROTOCOL</span>
                <span className="text-slate-400 text-xs font-medium">Standard Protocol: Side-View Seated Reach</span>
            </div>
            <h1 className="text-3xl font-bold text-slate-900">Modified Functional Reach Test</h1>
            <p className="text-slate-500 mt-2 text-lg">Digital Assessment for Post-Stroke Trunk Control</p>
        </div>

        {/* The Visual Guide */}
        <div className="flex-1 overflow-y-auto p-8 bg-slate-50">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                
                {/* Correct Form Card */}
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-emerald-100 ring-1 ring-emerald-50">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center">
                            <Check className="w-5 h-5 text-emerald-600" />
                        </div>
                        <h3 className="font-bold text-slate-900">Correct Technique</h3>
                    </div>
                    
                    {/* CSS Anatomy Diagram: Good (Hinging) */}
                    <div className="h-48 bg-slate-100 rounded-xl relative overflow-hidden mb-4 flex justify-center items-end pb-4">
                        {/* Chair */}
                        <div className="w-20 h-24 border-l-4 border-t-4 border-slate-300 rounded-tl-lg"></div>
                        {/* Torso (Hinging Forward) */}
                        <div className="absolute bottom-14 left-[40%] w-2 h-24 bg-emerald-500 rounded-full transform rotate-12 origin-bottom"></div>
                        {/* Head */}
                        <div className="absolute bottom-[145px] left-[45%] w-8 h-8 bg-emerald-500 rounded-full"></div>
                        {/* Arm (Reaching Far) */}
                        <div className="absolute bottom-[105px] left-[46%] w-28 h-2 bg-emerald-400 rounded-full origin-left animate-pulse"></div>
                        
                        <div className="absolute top-4 left-4 bg-emerald-100 text-emerald-700 text-xs font-bold px-2 py-1 rounded">
                            HIP HINGE ALLOWED
                        </div>
                    </div>
                    
                    <ul className="space-y-3 text-sm text-slate-600">
                        <li className="flex gap-2">✅ Hinge at your hips to reach forward.</li>
                        <li className="flex gap-2">✅ Keep your back straight, but allow your chest to move forward.</li>
                        <li className="flex gap-2">✅ Keep feet flat on the floor.</li>
                    </ul>
                </div>

                {/* Incorrect Form Card */}
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-rose-100 ring-1 ring-rose-50">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="w-8 h-8 rounded-full bg-rose-100 flex items-center justify-center">
                            <X className="w-5 h-5 text-rose-600" />
                        </div>
                        <h3 className="font-bold text-slate-900">Compensatory Failures</h3>
                    </div>

                    {/* CSS Anatomy Diagram: Bad (Butt Lift) */}
                    <div className="h-48 bg-slate-100 rounded-xl relative overflow-hidden mb-4 flex justify-center items-end pb-4">
                        {/* Chair */}
                        <div className="w-20 h-24 border-l-4 border-t-4 border-slate-300 rounded-tl-lg"></div>
                        {/* Torso (Lifted) */}
                        <div className="absolute bottom-20 left-[45%] w-2 h-24 bg-rose-500 rounded-full transform rotate-25 origin-bottom"></div>
                        {/* Head */}
                        <div className="absolute bottom-[170px] left-[55%] w-8 h-8 bg-rose-500 rounded-full"></div>
                        {/* Butt Gap */}
                        <div className="absolute bottom-14 left-[40%] w-8 h-2 bg-rose-600 animate-ping"></div>
                        
                        <div className="absolute top-4 right-4 bg-rose-100 text-rose-700 text-xs font-bold px-2 py-1 rounded">
                            FAIL: BUTT LIFT
                        </div>
                    </div>

                    <ul className="space-y-3 text-sm text-slate-600">
                        <li className="flex gap-2">❌ Lifting buttocks off the chair (Ischial Anchor violation).</li>
                        <li className="flex gap-2">❌ Curving the spine (Slouching).</li>
                        <li className="flex gap-2">❌ Using the other hand for support.</li>
                    </ul>
                </div>

            </div>
        </div>

        {/* Action Bar */}
        <div className="p-6 bg-white border-t border-slate-100 flex justify-between items-center">
            <p className="text-xs text-slate-400 max-w-md">
                *Position your camera for a SIDE VIEW (Profile). Ensure hips and shoulders are visible.
            </p>
            <button 
                onClick={onStart}
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-8 py-4 rounded-xl font-bold flex items-center gap-2 transition-all shadow-lg shadow-indigo-200"
            >
                <Play className="w-5 h-5 fill-current" />
                Initialize Session
            </button>
        </div>

      </div>
    </div>
  );
};
