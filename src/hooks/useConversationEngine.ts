import { useState, useEffect, useCallback, useRef } from 'react';
import { ConversationState, SessionMode, LLMMode } from '../types';
import { ConversationEngine } from '../engine/ConversationEngine';
import { WakeWordService } from '../services/wakeword/WakeWordService';
import { STTService } from '../services/stt/STTService';
import { TTSService } from '../services/tts/TTSService';
import { LocalLLMService } from '../services/llm/LocalLLMService';
import { GroqLLMService } from '../services/llm/GroqLLMService';
import { SessionRepository } from '../services/storage/SessionRepository';
import { TurnRepository } from '../services/storage/TurnRepository';
import { SummaryRepository } from '../services/storage/SummaryRepository';
import { PreferencesRepository } from '../services/storage/PreferencesRepository';
import { getDatabase } from '../services/storage/database';

export function useConversationEngine() {
  const engineRef = useRef<ConversationEngine | null>(null);
  const [state, setState] = useState<ConversationState>('idle');
  const [llmMode, setLlmMode] = useState<LLMMode>('local');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const db = await getDatabase();
      const prefs = await new PreferencesRepository(db).get();

      const localLLM = new LocalLLMService();
      // Model downloaded to device documents directory on first launch.
      // On iOS: <Documents>/llama-3.2-3b.gguf
      // On Android: <InternalStorage>/llama-3.2-3b.gguf
      // Download URL: https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF (Q4_K_M recommended)
      const { Platform } = require('react-native');
      const RNFS = require('react-native-fs');
      const modelPath = `${Platform.OS === 'ios' ? RNFS.DocumentDirectoryPath : RNFS.ExternalDirectoryPath}/llama-3.2-3b.gguf`;
      await localLLM.load(modelPath);

      const groqLLM = new GroqLLMService(prefs.groqApiKey);
      const tts = new TTSService();
      await tts.init(prefs.ttsRate);

      const engine = new ConversationEngine({
        wakeWord: new WakeWordService(),
        stt: new STTService(),
        tts,
        llm: prefs.llmMode === 'online' && groqLLM.isReady() ? groqLLM : localLLM,
        sessionRepo: new SessionRepository(db),
        turnRepo: new TurnRepository(db),
        summaryRepo: new SummaryRepository(db),
      });

      engine.setOnStateChange(setState);
      await engine.startIdle();
      engineRef.current = engine;
      setLlmMode(prefs.llmMode);
      setReady(true);
    })();
  }, []);

  const startSession = useCallback((mode: SessionMode) => {
    engineRef.current?.startSession(mode, llmMode);
  }, [llmMode]);

  const endSession = useCallback(() => {
    engineRef.current?.endSession();
  }, []);

  const toggleLLMMode = useCallback(() => {
    const newMode: LLMMode = llmMode === 'local' ? 'online' : 'local';
    engineRef.current?.toggleLLMMode(newMode);
    setLlmMode(newMode);
  }, [llmMode]);

  return { state, llmMode, ready, startSession, endSession, toggleLLMMode };
}
