import { ConversationState, SessionMode, LLMMode } from '../types';
import { ContextManager } from './ContextManager';
import { WakeWordService } from '../services/wakeword/WakeWordService';
import { STTService } from '../services/stt/STTService';
import { TTSService } from '../services/tts/TTSService';
import { LLMService } from '../services/llm/LLMService';
import { SessionRepository } from '../services/storage/SessionRepository';
import { TurnRepository } from '../services/storage/TurnRepository';
import { SummaryRepository } from '../services/storage/SummaryRepository';

const BYE_TOKA_PATTERNS = [/^bye\s+toka$/i, /^goodbye\s+toka$/i, /^bye-?bye\s+toka$/i];
const SUMMARY_TIMEOUT_MS = 30_000;

interface EngineServices {
  wakeWord: WakeWordService;
  stt: STTService;
  tts: TTSService;
  llm: LLMService;
  sessionRepo: SessionRepository;
  turnRepo: TurnRepository;
  summaryRepo: SummaryRepository;
}

export class ConversationEngine {
  state: ConversationState = 'idle';
  private context: ContextManager | null = null;
  private sessionId: number | null = null;
  private sessionMode: SessionMode = 'just-walk';
  private llmMode: LLMMode = 'local';
  private pendingModeSwitch: LLMMode | null = null;
  private onStateChange: ((state: ConversationState) => void) | null = null;

  constructor(private services: EngineServices) {}

  setOnStateChange(cb: (state: ConversationState) => void): void {
    this.onStateChange = cb;
  }

  async startIdle(): Promise<void> {
    await this.services.wakeWord.start(() => this.onWakeWordDetected());
    this.setState('idle');
  }

  async startSession(mode: SessionMode, llmMode: LLMMode): Promise<void> {
    this.sessionMode = mode;
    this.llmMode = llmMode;
    this.context = new ContextManager(mode);
    this.sessionId = await this.services.sessionRepo.create({
      mode,
      startedAt: Date.now(),
      modelUsed: llmMode,
    });

    await this.services.wakeWord.stop();
    this.services.stt.init({
      onResult: (text) => this.onUserSpeech(text),
      onError: () => this.startListening(),
    });
    this.startListening();
  }

  async endSession(): Promise<void> {
    await this.services.stt.stopListening();
    this.services.tts.stop();
    if (this.sessionId) {
      const endedAt = Date.now();
      await this.services.sessionRepo.end(this.sessionId, endedAt);
      this.generateSummaryWithTimeout(this.sessionId);
    }
    this.sessionId = null;
    this.context = null;
    this.setState('idle');
    await this.startIdle();
  }

  toggleLLMMode(newMode: LLMMode): void {
    if (this.state === 'thinking') {
      this.pendingModeSwitch = newMode;
    } else {
      this.llmMode = newMode;
    }
  }

  isByeToka(text: string): boolean {
    const trimmed = text.trim();
    return BYE_TOKA_PATTERNS.some(p => p.test(trimmed));
  }

  private onWakeWordDetected(): void {
    this.onStateChange?.('idle');
  }

  private startListening(): void {
    this.setState('listening');
    this.services.stt.startListening();
  }

  private async onUserSpeech(text: string): Promise<void> {
    if (this.isByeToka(text)) {
      await this.endSession();
      return;
    }

    this.context!.addUserTurn(text);
    await this.services.turnRepo.add({
      sessionId: this.sessionId!,
      speaker: 'user',
      text,
      status: 'completed',
    });

    await this.generateResponse();
  }

  private async generateResponse(): Promise<void> {
    this.setState('thinking');
    const messages = this.context!.getMessages();
    let fullResponse = '';
    let interrupted = false;

    try {
      for await (const token of this.services.llm.generate(messages)) {
        fullResponse += token;
        this.services.tts.feedToken(token);
        if (this.state === 'listening') {
          interrupted = true;
          break;
        }
        this.setState('speaking');
      }
      this.services.tts.flush();
    } catch {
      // LLM error — fall back silently
    }

    this.context!.addAssistantTurn(fullResponse, interrupted);
    await this.services.turnRepo.add({
      sessionId: this.sessionId!,
      speaker: 'ai',
      text: fullResponse,
      status: interrupted ? 'interrupted' : 'completed',
    });

    if (this.pendingModeSwitch) {
      this.llmMode = this.pendingModeSwitch;
      this.pendingModeSwitch = null;
    }

    if (!interrupted) this.startListening();
  }

  private async generateSummaryWithTimeout(sessionId: number): Promise<void> {
    const turns = await this.services.turnRepo.getForSession(sessionId);
    const transcript = turns
      .map(t => `${t.speaker === 'user' ? 'User' : 'Toka'}: ${t.text}`)
      .join('\n');

    const summaryMessages = [
      {
        role: 'system' as const,
        content:
          'Summarise the following conversation in 2-4 sentences, focusing on key insights or topics discussed. Be concise.',
      },
      { role: 'user' as const, content: transcript },
    ];

    try {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), SUMMARY_TIMEOUT_MS),
      );

      let summary = '';
      const generationPromise = (async () => {
        for await (const token of this.services.llm.generate(summaryMessages)) {
          summary += token;
        }
        return summary;
      })();

      const result = await Promise.race([generationPromise, timeoutPromise]);
      await this.services.summaryRepo.save(sessionId, result);
    } catch {
      await this.services.summaryRepo.save(sessionId, '');
    }
  }

  private setState(newState: ConversationState): void {
    this.state = newState;
    this.onStateChange?.(newState);
  }
}
