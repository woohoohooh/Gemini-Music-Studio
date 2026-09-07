/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Music, 
  Sparkles, 
  Play, 
  Pause, 
  Download, 
  Info, 
  Mic2, 
  Volume2, 
  RefreshCcw,
  Clock,
  Zap,
  HelpCircle,
  ExternalLink,
  Search,
  Heart,
  History,
  Trash2,
  ArrowRight
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI, Modality } from "@google/genai";

declare global {
  interface Window {
    aistudio: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

// Types
interface HistoryItem {
  id: string;
  prompt: string;
  model: string;
  timestamp: number;
  audioUrl: string;
  lyrics: string;
  isLiked: boolean;
  duration?: number;
}

// FAQ Data in Russian
const FAQ_RU = [
  {
    q: "Что значит 'User Tip' про лимиты и API?",
    a: "Это значит, что при использовании API ключа (который вы можете получить в Google Cloud Console), вы получаете доступ к более высоким квотам. В бесплатном режиме (Free Tier) есть ограничения на количество запросов в минуту и день. Платный режим (Pay-as-you-go) через API убирает эти барьеры, позволяя генерировать музыку без пауз и лимитов."
  },
  {
    q: "Лимиты и стоимость: API против Веб-интерфейса?",
    a: "В Google AI Studio (веб) и через API (по ключу) используются одни и те же модели. Основное отличие — в гибкости. 'Лайфхак' про дешевизну через API обычно означает, что вы платите за фактическое использование (Pay-as-you-go), а не фиксированную подписку. В AI Studio доступен бесплатный уровень (Free of charge) с лимитами (RPM/RPD), который идеален для экспериментов."
  },
  {
    q: "Lyria или MusicLM?",
    a: "Lyria — это новейшая флагманская модель от Google DeepMind. Она обеспечивает значительно более высокое качество звука и понимание музыкальной структуры. Рекомендуем использовать Lyria Pro для полноценных треков или Lyria Clip для коротких фрагментов до 30 секунд."
  }
];

export default function App() {
  // Prompts for different models
  const [promptClip, setPromptClip] = useState(() => localStorage.getItem('prompt_clip') || '');
  const [promptPro, setPromptPro] = useState(() => localStorage.getItem('prompt_pro') || '');
  const [modelType, setModelType] = useState<'lyria-3-clip-preview' | 'lyria-3-pro-preview'>('lyria-3-pro-preview');

  const [isGenerating, setIsGenerating] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [lyrics, setLyrics] = useState('');
  const [showFaq, setShowFaq] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Loop Generation state (Magnifying glass)
  const [isLoopActive, setIsLoopActive] = useState(false);
  const [loopStep, setLoopStep] = useState<'idle' | 'generating' | 'waiting_download' | 'waiting_next'>('idle');

  // Premium Toggle state
  const [isPremiumMode, setIsPremiumMode] = useState(true);

  // History state
  const [history, setHistory] = useState<HistoryItem[]>(() => {
    const saved = localStorage.getItem('music_history');
    return saved ? JSON.parse(saved) : [];
  });

  const audioRef = useRef<HTMLAudioElement | null>(null);
  
  const currentPrompt = modelType === 'lyria-3-clip-preview' ? promptClip : promptPro;

  const checkAndOpenKeySelector = async () => {
    if (window.aistudio) {
      const hasKey = await window.aistudio.hasSelectedApiKey();
      if (!hasKey) {
        await window.aistudio.openSelectKey();
        return true;
      }
    }
    return false;
  };

  const getAIInstance = () => {
    // Priority: 1. User-selected Paid Key, 2. Default AI Studio Key
    const apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("API Key not found. Please check your environment variables.");
    }
    return new GoogleGenAI({ apiKey });
  };

  // Save prompts and history to localStorage
  useEffect(() => {
    localStorage.setItem('prompt_clip', promptClip);
    localStorage.setItem('prompt_pro', promptPro);
  }, [promptClip, promptPro]);

  useEffect(() => {
    localStorage.setItem('music_history', JSON.stringify(history));
  }, [history]);

  const downloadAudio = useCallback((url: string, id?: string) => {
    const link = document.createElement('a');
    link.href = url;
    const randomId = Math.floor(Math.random() * 1000000000) + 1;
    link.download = `music_${id || randomId}.wav`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, []);

  const handleGenerate = async (explicitPrompt?: string, explicitModel?: 'lyria-3-clip-preview' | 'lyria-3-pro-preview') => {
    const targetModel = explicitModel || modelType;
    const targetPrompt = explicitPrompt || (targetModel === 'lyria-3-clip-preview' ? promptClip : promptPro);

    if (!targetPrompt.trim()) return;

    // Lyria models usually require a paid API key in AI Studio
    if (isPremiumMode) {
      await checkAndOpenKeySelector();
    }

    setIsGenerating(true);
    setAudioUrl(null);
    setLyrics('');
    setProgress(0);
    setError(null);

    try {
      const ai = getAIInstance();
      
      const result = await ai.models.generateContentStream({
        model: targetModel,
        contents: [{ role: 'user', parts: [{ text: targetPrompt }] }],
        config: {
          responseModalities: [Modality.AUDIO]
        }
      });

      let audioBase64 = "";
      let generatedLyrics = "";

      // In @google/genai, the response itself is the async iterator
      for await (const chunk of result) {
        const parts = chunk.candidates?.[0]?.content?.parts;
        if (!parts) continue;
        
        for (const part of parts) {
          // Check for audio data in inlineData
          if (part.inlineData?.data) {
            audioBase64 += part.inlineData.data;
          }
          // Some versions might use different structures for audio
          if ((part as any).audio?.data) {
             audioBase64 += (part as any).audio.data;
          }
          // Check for text data (lyrics)
          if (part.text) {
            generatedLyrics += part.text;
            setLyrics(generatedLyrics);
          }
        }
      }

      if (audioBase64) {
        const binary = atob(audioBase64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: 'audio/wav' });
        const url = URL.createObjectURL(blob);
        setAudioUrl(url);

        const newItem: HistoryItem = {
          id: Math.random().toString(36).substring(7),
          prompt: targetPrompt,
          model: targetModel,
          timestamp: Date.now(),
          audioUrl: url,
          lyrics: generatedLyrics,
          isLiked: false
        };
        setHistory(prev => [newItem, ...prev].slice(0, 50));
        
        return url;
      } else {
        throw new Error("Не удалось получить аудиоданные от модели. Попробуйте изменить промпт или модель.");
      }
    } catch (err: any) {
      console.error('Generation Error Detail:', err);
      const errorMessage = err.message || JSON.stringify(err);
      
      const isPermissionDenied = errorMessage.includes('403') || 
                                 errorMessage.includes('PERMISSION_DENIED') || 
                                 errorMessage.includes('Requested entity was not found') ||
                                 errorMessage.includes('not permitted');

      const isRateLimit = errorMessage.includes('429') || errorMessage.includes('quota');

      if (isPermissionDenied) {
        setError("Доступ заблокирован (403). Модели Lyria доступны только с платным API ключом или в специальных проектах. Пожалуйста, выберите другой ключ (Select Key) в AI Studio.");
        if (window.aistudio) {
          await window.aistudio.openSelectKey();
        }
      } else if (isRateLimit && !isPremiumMode) {
        setIsPremiumMode(true);
        setError("Бесплатные лимиты исчерпаны. Автоматическое переключение на Premium (API)... Попробуйте еще раз.");
      } else {
        setError(errorMessage || "Произошла ошибка при генерации. Пожалуйста, попробуйте еще раз.");
      }
      return null;
    } finally {
      setIsGenerating(false);
    }
  };

  // Loop Logic
  useEffect(() => {
    let timeoutId: any;
    if (isLoopActive) {
      if (loopStep === 'idle') {
        const startLoop = async () => {
          setLoopStep('generating');
          const url = await handleGenerate();
          if (url) {
            setLoopStep('waiting_download');
            timeoutId = setTimeout(() => {
              downloadAudio(url);
              setLoopStep('waiting_next');
              timeoutId = setTimeout(() => {
                setLoopStep('idle');
              }, 10000); // 10s wait before next gen
            }, 10000); // 10s wait before download
          } else {
            // Error case: stay in waiting_next state for 10s before retrying
            setLoopStep('waiting_next');
            timeoutId = setTimeout(() => {
              setLoopStep('idle');
            }, 10000); 
          }
        };
        startLoop();
      }
    } else {
      setLoopStep('idle');
    }
    return () => clearTimeout(timeoutId);
  }, [isLoopActive, loopStep, downloadAudio]);

  const toggleLike = (id: string) => {
    setHistory(prev => prev.map(item => item.id === id ? { ...item, isLiked: !item.isLiked } : item));
  };

  const deleteHistory = (id: string) => {
    setHistory(prev => prev.filter(item => item.id !== id));
  };

  const togglePlay = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const onTimeUpdate = () => {
    if (audioRef.current) {
      const current = audioRef.current.currentTime;
      const duration = audioRef.current.duration;
      setProgress((current / duration) * 100);
    }
  };

  const extendTrack = async (item: HistoryItem) => {
    setModelType('lyria-3-pro-preview');
    await handleGenerate(item.prompt, 'lyria-3-pro-preview');
  };

  const [historyTab, setHistoryTab] = useState<'all' | 'pro' | 'clip'>('all');

  const filteredHistory = history.filter(item => {
    if (historyTab === 'all') return true;
    if (historyTab === 'pro') return item.model === 'lyria-3-pro-preview';
    if (historyTab === 'clip') return item.model === 'lyria-3-clip-preview';
    return true;
  });

  return (
    <div className="h-screen bg-[#050505] text-slate-100 flex flex-col font-sans overflow-hidden">
      {/* Header */}
      <header className="h-20 border-b border-white/10 flex items-center justify-between px-8 bg-[#0a0a0a] shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-gradient-to-tr from-amber-500 to-orange-700 rounded-full flex items-center justify-center shadow-lg shadow-amber-900/20">
            <div className="w-4 h-4 bg-black rounded-sm transform rotate-45 flex items-center justify-center">
              <div className="w-1 h-1 bg-white rounded-full"></div>
            </div>
          </div>
          <h1 className="text-xl tracking-widest font-light uppercase" style={{ fontFamily: "'Georgia', serif" }}>
            Gemini <span className="font-bold">Sonic</span> Lab
          </h1>
        </div>
        <nav className="flex gap-8 text-[11px] uppercase tracking-[0.2em] text-slate-400 font-medium items-center">
          <button 
            onClick={() => setShowFaq(!showFaq)}
            className={`hover:text-white transition-colors pb-1 ${showFaq ? 'text-white border-b border-amber-500' : ''}`}
          >
            Insights & FAQ
          </button>
          <div className="flex items-center gap-3 bg-zinc-900 rounded-full px-4 py-1.5 border border-white/5">
            <span className={`text-[9px] ${isPremiumMode ? 'text-amber-500' : 'text-slate-500'}`}>
              {isPremiumMode ? 'PREMIUM (API)' : 'FREE TIER'}
            </span>
            <button 
              onClick={() => setIsPremiumMode(!isPremiumMode)}
              className={`w-8 h-4 rounded-full relative transition-colors ${isPremiumMode ? 'bg-amber-500' : 'bg-slate-700'}`}
            >
              <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${isPremiumMode ? 'right-0.5' : 'left-0.5'}`} />
            </button>
          </div>
          <a href="https://aistudio.google.com/app/prompts/new_music" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors flex items-center gap-1">
            Native Studio <ExternalLink size={10} />
          </a>
        </nav>
      </header>

      {/* Main Workspace */}
      <main className="flex-1 flex overflow-hidden">
        {/* Sidebar: Model Selection & Loops */}
        <aside className="w-80 border-r border-white/5 p-6 flex flex-col gap-6 bg-[#050505] overflow-y-auto shrink-0">
          <div>
            <label className="text-[10px] uppercase tracking-widest text-slate-500 mb-4 block">Active Engine</label>
            <div className="space-y-3">
              <div 
                onClick={() => setModelType('lyria-3-pro-preview')}
                className={`p-4 rounded-xl border transition-all cursor-pointer ${
                  modelType === 'lyria-3-pro-preview' 
                    ? 'border-amber-500/30 bg-amber-500/5' 
                    : 'border-white/5 bg-white/5 hover:bg-white/10'
                }`}
              >
                <div className="flex justify-between items-start mb-2">
                  <h3 className={`font-semibold ${modelType === 'lyria-3-pro-preview' ? 'text-amber-500' : 'text-slate-200'}`}>Lyria Pro</h3>
                  <span className={`text-[9px] px-2 py-0.5 rounded ${
                    modelType === 'lyria-3-pro-preview' ? 'bg-amber-500/20 text-amber-300' : 'bg-slate-700 text-slate-300'
                  }`}>Full Track</span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">2.5 - 3 min high-quality tracks.</p>
              </div>
              
              <div 
                onClick={() => setModelType('lyria-3-clip-preview')}
                className={`p-4 rounded-xl border transition-all cursor-pointer ${
                  modelType === 'lyria-3-clip-preview' 
                    ? 'border-amber-500/30 bg-amber-500/5' 
                    : 'border-white/5 bg-white/5 hover:bg-white/10'
                }`}
              >
                <div className="flex justify-between items-start mb-2">
                  <h3 className={`font-semibold ${modelType === 'lyria-3-clip-preview' ? 'text-amber-500' : 'text-slate-200'}`}>Lyria Clip</h3>
                  <span className={`text-[9px] px-2 py-0.5 rounded ${
                    modelType === 'lyria-3-clip-preview' ? 'bg-amber-500/20 text-amber-300' : 'bg-slate-700 text-slate-300'
                  }`}>30s Sketch</span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">Fast previews and ideas.</p>
              </div>
            </div>
          </div>

          {/* Loop Control Tool */}
          <div className="p-4 rounded-xl bg-slate-900/50 border border-white/5 space-y-4">
             <div className="flex items-center justify-between">
                <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Auto-Loop Engine</h4>
                <button 
                  onClick={() => setIsLoopActive(!isLoopActive)}
                  className={`p-2 rounded-lg transition-all ${isLoopActive ? 'bg-amber-500 text-black shadow-lg shadow-amber-500/20' : 'bg-zinc-800 text-zinc-500 hover:text-white'}`}
                  title="Toggle Infinite Generation Loop"
                >
                  <Search size={16} />
                </button>
             </div>
             <div className="text-[10px] text-slate-500 leading-relaxed italic">
                {isLoopActive ? (
                  <span className="text-amber-400 flex items-center gap-2">
                    <RefreshCcw size={12} className="animate-spin" />
                    {loopStep === 'generating' ? 'Generating...' : loopStep === 'waiting_download' ? 'Downloading in 10s...' : 'Next gen in 10s...'}
                  </span>
                ) : (
                  'Click the search icon to enable infinite generation and auto-download.'
                )}
             </div>
          </div>

          <div className="mt-auto p-4 rounded-xl bg-slate-900/50 border border-white/5">
            <h4 className="text-xs font-bold mb-2 text-amber-500 flex items-center gap-2">
              <History size={12} />
              Recent Logs
            </h4>
            <div className="space-y-3 max-h-40 overflow-y-auto custom-scrollbar pr-2">
              {history.slice(0, 5).map(item => (
                <div key={item.id} className="text-[10px] text-slate-500 pb-2 border-b border-white/5 last:border-0 truncate">
                  {item.prompt}
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* Central Content Area */}
        <section className="flex-1 flex flex-col bg-[#080808] overflow-hidden">
          <AnimatePresence mode="wait">
            {showFaq ? (
              <motion.div 
                key="faq"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="flex-1 p-8 overflow-y-auto space-y-8"
              >
                <div className="grid grid-cols-2 gap-6">
                  <div className="bg-[#0d0d0d] p-6 rounded-2xl border border-white/5">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                      <h2 className="text-sm font-bold uppercase tracking-wider">AI Studio Web</h2>
                    </div>
                    <ul className="space-y-3 text-[13px] text-slate-400">
                      <li className="flex justify-between"><span>Cost</span> <span className="text-white">Free (Tiered)</span></li>
                      <li className="flex justify-between"><span>Limit</span> <span className="text-white">Track Refresh Quota</span></li>
                      <li className="flex justify-between"><span>Quality</span> <span className="text-white">Interface Standard</span></li>
                    </ul>
                  </div>
                  <div className="bg-[#0d0d0d] p-6 rounded-2xl border border-amber-500/10 shadow-inner shadow-amber-500/5">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-2 h-2 bg-amber-500 rounded-full"></div>
                      <h2 className="text-sm font-bold uppercase tracking-wider">API Keys</h2>
                    </div>
                    <ul className="space-y-3 text-[13px] text-slate-400">
                      <li className="flex justify-between"><span>Cost</span> <span className="text-white">Pay-per-token</span></li>
                      <li className="flex justify-between"><span>Limit</span> <span className="text-white">Enterprise Tier</span></li>
                      <li className="flex justify-between"><span>Control</span> <span className="text-white">Full SDK Parametric</span></li>
                    </ul>
                  </div>
                </div>

                <div className="space-y-6">
                  <h3 className="text-lg font-light tracking-wide text-slate-200">Common Inquiries</h3>
                  {FAQ_RU.map((item, i) => (
                    <div key={i} className="p-5 rounded-xl border border-white/5 bg-white/5 space-y-2">
                      <h4 className="text-amber-500 text-sm font-semibold">{item.q}</h4>
                      <p className="text-slate-400 text-sm leading-relaxed">{item.a}</p>
                    </div>
                  ))}
                </div>
              </motion.div>
            ) : (
              <motion.div 
                key="main"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex-1 flex flex-col"
              >
                {/* Generation Feedback Area */}
                <div className="flex-1 p-8 flex flex-col justify-center items-center overflow-y-auto">
                  {error && (
                    <motion.div 
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="w-full max-w-2xl mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center justify-between"
                    >
                      <div className="flex items-center gap-3">
                        <Info size={16} />
                        <span>{error}</span>
                      </div>
                      <button onClick={() => setError(null)} className="text-red-400/50 hover:text-red-400 transition-colors">
                        <Trash2 size={14} />
                      </button>
                    </motion.div>
                  )}
                  <div className="w-full max-w-2xl bg-[#0d0d0d] p-8 rounded-2xl border border-white/5 shadow-2xl space-y-6">
                    {/* Visualizer and Audio Controls */}
                    <div className="h-40 bg-black/40 rounded-xl border border-white/5 flex flex-col items-center justify-center relative overflow-hidden">
                       {isGenerating ? (
                        <div className="flex items-end gap-1.5 h-16">
                          {[...Array(24)].map((_, i) => (
                            <motion.div 
                              key={i}
                              animate={{ height: [8, 64, 16, 64, 8] }}
                              transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.05 }}
                              className="w-1 bg-amber-500/40 rounded-full"
                            />
                          ))}
                        </div>
                       ) : audioUrl ? (
                        <div className="flex items-center gap-1.5 h-16 opacity-60">
                          {[...Array(24)].map((_, i) => (
                            <div 
                              key={i}
                              style={{ height: `${20 + Math.random() * 80}%` }}
                              className={`w-1 rounded-full ${isPlaying ? 'bg-amber-500' : 'bg-slate-700'}`}
                            />
                          ))}
                        </div>
                       ) : (
                        <div className="text-slate-700 text-xs font-mono uppercase tracking-[0.3em]">Ready for Generation</div>
                       )}
                    </div>

                    <div className="space-y-4">
                      {/* Controls Row */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <button 
                            onClick={togglePlay}
                            disabled={!audioUrl}
                            className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${
                              !audioUrl 
                                ? 'bg-slate-800 text-slate-600 cursor-not-allowed'
                                : 'bg-amber-500 text-black hover:scale-105 active:scale-95 shadow-lg shadow-amber-500/20'
                            }`}
                          >
                            {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" className="ml-1" />}
                          </button>
                          <div>
                            <div className="text-[10px] text-slate-500 uppercase tracking-widest mb-0.5">Dynamic Range</div>
                            <div className="text-white font-mono text-xs">Spotify/YT Optimized</div>
                          </div>
                        </div>
                        <div className="flex flex-col items-end">
                           <div className="text-[10px] text-slate-500 uppercase tracking-widest mb-0.5">WAV Output</div>
                           <div className="text-white font-mono text-xs">
                              {audioRef.current ? `${formatTime(audioRef.current.currentTime)} / ${formatTime(audioRef.current.duration)}` : "0:00 / 0:00"}
                           </div>
                        </div>
                      </div>

                      {/* Scrub Bar */}
                      <div className="relative h-1 bg-slate-800 rounded-full overflow-hidden">
                        <motion.div 
                          className="absolute inset-y-0 left-0 bg-amber-500" 
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Generation Interface Input */}
                <div className="px-8 pb-10">
                  <div className="relative max-w-3xl mx-auto group">
                    <textarea 
                      value={modelType === 'lyria-3-clip-preview' ? promptClip : promptPro}
                      onChange={(e) => modelType === 'lyria-3-clip-preview' ? setPromptClip(e.target.value) : setPromptPro(e.target.value)}
                      disabled={isGenerating}
                      className="w-full bg-slate-900/40 border border-white/10 rounded-2xl p-6 text-lg font-light text-slate-200 focus:outline-none focus:border-amber-500/50 resize-none h-32 placeholder-slate-600 transition-colors custom-scrollbar"
                      placeholder={`Prompt for ${modelType === 'lyria-3-clip-preview' ? 'Clip' : 'Pro'}...`}
                    ></textarea>
                    <button 
                      onClick={() => handleGenerate()}
                      disabled={isGenerating || !currentPrompt.trim()}
                      className={`absolute bottom-4 right-4 px-6 py-3 rounded-full font-bold uppercase text-xs tracking-widest transition-all ${
                        isGenerating || !currentPrompt.trim()
                          ? 'bg-slate-800 text-slate-600 cursor-not-allowed'
                          : 'bg-amber-500 text-black shadow-xl shadow-amber-500/20 hover:scale-105 active:scale-95'
                      }`}
                    >
                      {isGenerating ? 'Processing...' : 'Generate WAV'}
                    </button>
                  </div>

                  <div className="mt-6 flex items-center justify-center gap-12 border-t border-white/5 pt-4 max-w-3xl mx-auto">
                    <div className="text-center">
                      <div className="text-slate-400 text-[10px] uppercase tracking-widest mb-1">Quality</div>
                      <div className="text-amber-500 font-mono text-xs flex items-center gap-1.5 justify-center">
                         Master Grade
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="text-slate-400 text-[10px] uppercase tracking-widest mb-1">Bit Depth</div>
                      <div className="text-white font-mono text-xs">32-bit Float</div>
                    </div>
                    <div className="text-center">
                      <div className="text-slate-400 text-[10px] uppercase tracking-widest mb-1">Status</div>
                      <div className="text-white font-mono text-xs uppercase italic">{isPremiumMode ? 'API High' : 'Standard'}</div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        {/* Right: History Panel */}
        <aside className="w-80 border-l border-white/5 p-6 bg-[#0a0a0a] overflow-y-auto shrink-0 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[10px] uppercase tracking-widest text-slate-500 flex items-center gap-2">
              <History size={12} />
              Vault
            </h3>
            <div className="flex bg-zinc-900 rounded-md p-0.5 border border-white/5">
               {(['all', 'pro', 'clip'] as const).map(tab => (
                 <button 
                  key={tab}
                  onClick={() => setHistoryTab(tab)}
                  className={`px-2 py-1 text-[9px] uppercase font-bold rounded transition-all ${historyTab === tab ? 'bg-amber-500 text-black' : 'text-slate-500 hover:text-slate-300'}`}
                 >
                   {tab}
                 </button>
               ))}
            </div>
          </div>

          <div className="space-y-4 flex-1">
            {filteredHistory.length === 0 ? (
              <div className="text-center py-20 text-slate-700 text-xs italic">
                No {historyTab !== 'all' ? historyTab : ''} tracks recorded
              </div>
            ) : (
              filteredHistory.map(item => (
                <div key={item.id} className="p-4 rounded-xl bg-white/5 border border-white/5 space-y-3 relative group">
                  <div className="text-[11px] text-slate-300 line-clamp-2 leading-relaxed">
                    {item.prompt}
                  </div>
                  <div className="flex items-center justify-between pt-2">
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => {
                          setAudioUrl(item.audioUrl);
                          setLyrics(item.lyrics);
                          setTimeout(() => togglePlay(), 100);
                        }}
                        className="p-1.5 rounded-full bg-zinc-800 text-slate-300 hover:text-white"
                      >
                        <Play size={12} fill="currentColor" />
                      </button>
                      <button 
                        onClick={() => downloadAudio(item.audioUrl, item.id)}
                        className="p-1.5 rounded-full bg-zinc-800 text-slate-300 hover:text-white"
                      >
                        <Download size={12} />
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                       {item.model === 'lyria-3-clip-preview' && (
                         <button 
                            onClick={() => extendTrack(item)}
                            title="Extend to Pro"
                            className="p-1.5 rounded-full bg-amber-500/10 text-amber-500 hover:bg-amber-500 hover:text-black transition-all"
                          >
                            <ArrowRight size={12} />
                          </button>
                       )}
                       <button 
                        onClick={() => toggleLike(item.id)}
                        className={`p-1.5 rounded-full border transition-all ${item.isLiked ? 'bg-amber-500/20 border-amber-500 text-amber-500' : 'bg-transparent border-slate-800 text-slate-600 hover:border-slate-500'}`}
                      >
                        <Heart size={12} fill={item.isLiked ? 'currentColor' : 'none'} />
                      </button>
                      <button 
                        onClick={() => deleteHistory(item.id)}
                        className="p-1.5 rounded-full hover:bg-red-500/20 hover:text-red-500 text-slate-600"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                  <div className="text-[9px] text-slate-600 font-mono flex items-center justify-between">
                    <span>{item.model.split('-')[1].toUpperCase()}</span>
                    <span>{new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="mt-8 p-4 rounded-lg bg-red-950/20 border border-red-500/20 shrink-0">
             <div className="text-[9px] font-bold text-red-400 uppercase mb-1 tracking-tighter">Enterprise Mode</div>
             <p className="text-[11px] text-red-300/70">Enable API toggle above for unlimited parallel generations.</p>
          </div>
        </aside>
      </main>

      <audio 
        ref={audioRef} 
        src={audioUrl || undefined} 
        onTimeUpdate={onTimeUpdate}
        onEnded={() => setIsPlaying(false)}
        className="hidden"
      />

      <style dangerouslySetInnerHTML={{ __html: `
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(0, 0, 0, 0.2);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.2);
        }
        /* Style for Firefox */
        .custom-scrollbar {
          scrollbar-width: thin;
          scrollbar-color: rgba(255, 255, 255, 0.1) rgba(0, 0, 0, 0.2);
        }
      `}} />
    </div>
  );
}

function formatTime(seconds: number) {
  if (isNaN(seconds)) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
