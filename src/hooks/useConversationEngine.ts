import { useState, useEffect, useCallback, useRef } from 'react';
import { Platform } from 'react-native';
import { DocumentDirectoryPath, ExternalDirectoryPath } from 'react-native-fs';
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
      // Models live in the device's documents directory (downloaded on first launch).
      // LLM:      https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF (Q4_K_M, ~2GB)
      // Vosk:     https://alphacephei.com/vosk/models → vosk-model-small-en-us-0.15 (~40MB)
      const docsDir = Platform.OS === 'ios' ? DocumentDirectoryPath : ExternalDirectoryPath;
      const llmModelPath = `${docsDir}/llama-3.2-3b.gguf`;
      const wakeModelPath = `${docsDir}/vosk-model-small-en-us-0.15`;
      await localLLM.load(llmModelPath);

      const groqLLM = new GroqLLMService(prefs.groqApiKey);
      const tts = new TTSService();
      await tts.init(prefs.ttsRate);

      const engine = new ConversationEngine({
        wakeWord: new WakeWordService(wakeModelPath),
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
