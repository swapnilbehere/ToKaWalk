import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { ConversationState, SessionMode, LLMMode, InputMode } from '../types';
import { LLM_MODEL_PATH } from '../services/ModelManager';
import { ConversationEngine } from '../engine/ConversationEngine';
import { STTService } from '../services/stt/STTService';
import { TTSService } from '../services/tts/TTSService';
import { LocalLLMService } from '../services/llm/LocalLLMService';
import { GroqLLMService } from '../services/llm/GroqLLMService';
import { SessionRepository } from '../services/storage/SessionRepository';
import { TurnRepository } from '../services/storage/TurnRepository';
import { SummaryRepository } from '../services/storage/SummaryRepository';
import { PreferencesRepository } from '../services/storage/PreferencesRepository';
import { getDatabase } from '../services/storage/database';
import { EngineResponse } from '../engine/ConversationEngine';

interface ConversationEngineContextValue {
  state: ConversationState;
  statusDetail: string | null;
  llmMode: LLMMode;
  sttMode: 'online' | 'offline';
  ready: boolean;
  startSession: (mode: SessionMode, inputMode?: InputMode) => void;
  endSession: () => void;
  toggleLLMMode: () => void;
  processTextInput: (text: string, onToken?: (token: string) => void) => Promise<EngineResponse>;
  updateGroqApiKey: (key: string) => void;
}

const ConversationEngineContext = createContext<ConversationEngineContextValue | null>(null);

export function ConversationEngineProvider({ children }: { children: React.ReactNode }) {
  const engineRef = useRef<ConversationEngine | null>(null);
  const groqLLMRef = useRef<GroqLLMService | null>(null);
  const prefsRepoRef = useRef<PreferencesRepository | null>(null);
  const llmModeRef = useRef<LLMMode>('local');
  const [state, setState] = useState<ConversationState>('idle');
  const [statusDetail, setStatusDetail] = useState<string | null>(null);
  const [llmMode, setLlmMode] = useState<LLMMode>('local');
  const [sttMode, setSttMode] = useState<'online' | 'offline'>('online');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const db = getDatabase();
        const prefsRepo = new PreferencesRepository(db);
        prefsRepoRef.current = prefsRepo;
        const prefs = await prefsRepo.get();

        const localLLM = new LocalLLMService(LLM_MODEL_PATH);
        const groqLLM = new GroqLLMService(prefs.groqApiKey);
        groqLLMRef.current = groqLLM;
        const tts = new TTSService();
        await tts.init(prefs.ttsRate);

        const engine = new ConversationEngine({
          stt: new STTService(),
          tts,
          localLLM,
          onlineLLM: groqLLM,
          sessionRepo: new SessionRepository(db),
          turnRepo: new TurnRepository(db),
          summaryRepo: new SummaryRepository(db),
        });

        if (cancelled) return;

        engine.setOnStateChange(setState);
        engine.setOnStatusDetailChange(setStatusDetail);
        engine.setOnSttModeChange(setSttMode);
        await engine.startIdle();
        engineRef.current = engine;
        if (prefs.llmMode === 'online') {
          engine.toggleLLMMode('online');
        }
        llmModeRef.current = prefs.llmMode;
        setLlmMode(prefs.llmMode);
        setReady(true);

        // Pre-warm the local model in the background so the first response is instant
        localLLM.load().catch(e => console.warn('[Engine] Local model pre-warm failed', e));

        // Trigger on-device STT model download silently in background (Android 13+).
        // No-op if already installed or on older OS versions.
        const stt = new STTService();
        stt.triggerOnDeviceModelDownload()
          .then(triggered => {
            if (triggered) console.log('[Engine] On-device STT model download triggered');
          })
          .catch(() => {});
      } catch (e) {
        console.error('[Engine] Failed to initialize:', e);
      }
    })();

    return () => {
      cancelled = true;
      engineRef.current?.endSession();
    };
  }, []);

  const startSession = useCallback((mode: SessionMode, inputMode: InputMode = 'voice') => {
    engineRef.current?.startSession(mode, llmModeRef.current, inputMode);
  }, []);

  const endSession = useCallback(() => {
    engineRef.current?.endSession();
  }, []);

  const toggleLLMMode = useCallback(() => {
    const newMode: LLMMode = llmMode === 'local' ? 'online' : 'local';
    engineRef.current?.toggleLLMMode(newMode);
    llmModeRef.current = newMode;
    setLlmMode(newMode);
    prefsRepoRef.current?.set('llmMode', newMode).catch((error) => {
      console.warn('[Engine] Failed to persist llmMode preference', error);
    });
  }, [llmMode]);

  const processTextInput = useCallback(async (text: string, onToken?: (token: string) => void) => {
    if (!engineRef.current) {
      throw new Error('Conversation engine is not ready');
    }
    return engineRef.current.processTextInput(text, onToken);
  }, []);

  const updateGroqApiKey = useCallback((key: string) => {
    groqLLMRef.current?.setApiKey(key);
    prefsRepoRef.current?.set('groqApiKey', key).catch((error) => {
      console.warn('[Engine] Failed to persist groqApiKey', error);
    });
  }, []);

  return (
    <ConversationEngineContext.Provider value={{ state, statusDetail, llmMode, sttMode, ready, startSession, endSession, toggleLLMMode, processTextInput, updateGroqApiKey }}>
      {children}
    </ConversationEngineContext.Provider>
  );
}

export function useConversationEngine(): ConversationEngineContextValue {
  const ctx = useContext(ConversationEngineContext);
  if (!ctx) throw new Error('useConversationEngine must be used inside ConversationEngineProvider');
  return ctx;
}
