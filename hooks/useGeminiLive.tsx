
import { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, FunctionDeclaration, Type } from '@google/genai';

const SYSTEM_INSTRUCTION = `ROLE: You are "NeuroBot," an AR Rehab Coach. 
CONTEXT: The user is playing a reach game for stroke recovery.
INPUT: Telemetry + Images.

DECISION LOGIC:
1. **DANGER**: If user leans > 18°, shout "Use your ARM, not your BACK!"
2. **ENCOURAGE**: If moving well, say "Great precision!" or "Combo king!"
3. **COMMANDS**:
    - "Recalibrate" -> Call start_calibration
    - "Start Game" -> Call start_game
3. **STYLE**: Cyberpunk, energetic, concise (<10 words).

AUDIO: Speak quickly and clearly.`;

const tools: FunctionDeclaration[] = [
    {
        name: 'start_calibration',
        description: 'Triggers the calibration sequence. Use when user says "Recalibrate", "Reset", or "Setup".',
        parameters: { type: Type.OBJECT, properties: {} }
    },
    {
        name: 'start_game',
        description: 'Starts the game session. Use when user says "Start Game", "Begin", or "Let\'s Play".',
        parameters: { type: Type.OBJECT, properties: {} }
    }
];

// WORKLET CODE: Runs in separate audio thread for stable 16kHz stream
const WORKLET_CODE = `
class PCMProcessor extends AudioWorkletProcessor {
    process(inputs, outputs, parameters) {
        const input = inputs[0];
        if (input && input.length > 0) {
            const channelData = input[0]; // Float32Array
            // Send to main thread for encoding
            this.port.postMessage(channelData);
        }
        return true;
    }
}
registerProcessor('pcm-processor', PCMProcessor);
`;

interface UseGeminiLiveProps {
    onCalibrationCmd?: () => void;
    onStartGameCmd?: () => void;
}

export const useGeminiLive = ({ onCalibrationCmd, onStartGameCmd }: UseGeminiLiveProps = {}) => {
  const [isConnected, setIsConnected] = useState(false);
  const [messages, setMessages] = useState<Array<{role: 'user' | 'model', text: string}>>([]);
  const [volume, setVolume] = useState(0);
  
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const inputContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);

  // Initialize Audio Output (Speaker)
  const initAudioOutput = useCallback(() => {
    if (!audioContextRef.current) {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        audioContextRef.current = new AudioContextClass({ sampleRate: 24000 });
    }
  }, []);

  const resumeAudio = useCallback(async () => {
    if (!audioContextRef.current) {
        initAudioOutput();
    }
    if (audioContextRef.current?.state === 'suspended') {
        await audioContextRef.current.resume();
    }
  }, [initAudioOutput]);

  // Audio Input Processing (Mic -> Worklet -> PCM 16kHz -> Gemini)
  const startAudioInput = useCallback(async () => {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaStreamRef.current = stream;

        // Force 16kHz context for simple resampling
        const inputContext = new AudioContext({ sampleRate: 16000 });
        inputContextRef.current = inputContext;

        // Load Worklet
        const blob = new Blob([WORKLET_CODE], { type: 'application/javascript' });
        const url = URL.createObjectURL(blob);
        await inputContext.audioWorklet.addModule(url);

        const source = inputContext.createMediaStreamSource(stream);
        const workletNode = new AudioWorkletNode(inputContext, 'pcm-processor');
        workletNodeRef.current = workletNode;

        // Worklet Message Handler (High frequency)
        workletNode.port.onmessage = (e) => {
            const inputData = e.data as Float32Array;
            
            // 1. Calculate Volume (RMS) for UI
            // Simple subset sampling for UI perf
            let sum = 0;
            for(let i=0; i<inputData.length; i+=4) sum += inputData[i] * inputData[i];
            const rms = Math.sqrt(sum / (inputData.length / 4));
            setVolume(Math.min(100, rms * 400)); 

            // 2. Convert Float32 -> Int16 PCM
            const pcm16 = new Int16Array(inputData.length);
            for (let i = 0; i < inputData.length; i++) {
                const s = Math.max(-1, Math.min(1, inputData[i]));
                pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
            }

            // 3. Base64 Encode and Send
            // Using a more efficient binary to string approach for the socket
            let binary = '';
            const bytes = new Uint8Array(pcm16.buffer);
            const len = bytes.byteLength;
            // Chunk processing for large buffers if needed, but 128 frames is small
            for (let i = 0; i < len; i++) {
                binary += String.fromCharCode(bytes[i]);
            }
            const base64Data = btoa(binary);

            if (sessionPromiseRef.current) {
                sessionPromiseRef.current.then(session => {
                    session.sendRealtimeInput({
                        mimeType: "audio/pcm;rate=16000",
                        data: base64Data
                    });
                });
            }
        };

        source.connect(workletNode);
        // Worklet needs to connect to destination to be clocked, but we don't want to hear it
        workletNode.connect(inputContext.destination);

    } catch (err) {
        console.error("Mic Access/Worklet Error:", err);
    }
  }, []);

  const stopAudioInput = useCallback(() => {
    if (workletNodeRef.current) {
        workletNodeRef.current.disconnect();
        workletNodeRef.current = null;
    }
    if (inputContextRef.current) {
        inputContextRef.current.close();
        inputContextRef.current = null;
    }
    if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(track => track.stop());
        mediaStreamRef.current = null;
    }
    setVolume(0);
  }, []);

  const connect = useCallback(async () => {
    if (!process.env.API_KEY) return;
    initAudioOutput();
    
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    sessionPromiseRef.current = ai.live.connect({
      model: 'gemini-2.5-flash-native-audio-preview-09-2025', 
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        tools: [{ functionDeclarations: tools }],
        responseModalities: [Modality.AUDIO], 
      },
      callbacks: {
        onopen: () => {
            setIsConnected(true);
            startAudioInput(); 
        },
        onclose: () => {
            setIsConnected(false);
            stopAudioInput();
        },
        onmessage: async (msg: LiveServerMessage) => {
            // Handle Audio Output
            const audioData = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (audioData && audioContextRef.current) {
                const ctx = audioContextRef.current;
                const binary = atob(audioData);
                const bytes = new Uint8Array(binary.length);
                for(let i=0; i<binary.length; i++) bytes[i] = binary.charCodeAt(i);
                
                const int16 = new Int16Array(bytes.buffer);
                const buffer = ctx.createBuffer(1, int16.length, 24000);
                const channel = buffer.getChannelData(0);
                for(let i=0; i<int16.length; i++) channel[i] = int16[i] / 32768.0;

                const source = ctx.createBufferSource();
                source.buffer = buffer;
                source.connect(ctx.destination);
                source.start();
            }
            
            const text = msg.serverContent?.modelTurn?.parts?.find(p => p.text)?.text;
            if (text) setMessages(p => [...p, { role: 'model', text }]);

            // Handle Function Calls
            if (msg.toolCall) {
                const session = await sessionPromiseRef.current;
                for (const fc of msg.toolCall.functionCalls) {
                    if (fc.name === 'start_calibration') {
                         if (onCalibrationCmd) onCalibrationCmd();
                         session.sendToolResponse({
                            functionResponses: [{ id: fc.id, name: fc.name, response: { result: "Calibration sequence started." } }]
                         });
                    }
                    if (fc.name === 'start_game') {
                        if (onStartGameCmd) onStartGameCmd();
                        session.sendToolResponse({
                           functionResponses: [{ id: fc.id, name: fc.name, response: { result: "Game session started." } }]
                        });
                   }
                }
            }
        }
      }
    });
  }, [initAudioOutput, onCalibrationCmd, onStartGameCmd, startAudioInput, stopAudioInput]);

  const sendVisualAlert = useCallback(async (base64Image: string, telemetry: string) => {
    if (!sessionPromiseRef.current) return;
    const cleanImage = base64Image.split(',')[1];
    setMessages(p => [...p, { role: 'user', text: `ALERT: ${telemetry}` }]);
    const session = await sessionPromiseRef.current;
    await session.sendRealtimeInput({
        content: [
            { text: `CONTEXT: ${telemetry}` },
            { inlineData: { mimeType: 'image/jpeg', data: cleanImage } }
        ]
    });
  }, []);

  return { isConnected, connect, sendVisualAlert, messages, resumeAudio, volume };
};
