import { ConversationState, SessionMode, LLMMode, InputMode, STTErrorInfo } from '../types';
import { ContextManager } from './ContextManager';
import { STTService } from '../services/stt/STTService';
import { TTSService } from '../services/tts/TTSService';
import { LLMService } from '../services/llm/LLMService';
import { SessionRepository } from '../services/storage/SessionRepository';
import { TurnRepository } from '../services/storage/TurnRepository';
import { SummaryRepository } from '../services/storage/SummaryRepository';

// "by/buy" are common STT mishearings of "bye".
const BYE_WORD = /^(bye|by|buy|goodbye|bye-?bye)$/i;
const NOVA_WORD = /nova/i;
const SUMMARY_TIMEOUT_MS = 30_000;
const STT_RESTART_DELAY_MS = 1_500;
const MAX_CONSECUTIVE_STT_ERRORS = 3;
const TTS_TAIL_DELAY_MS = 150;
const NO_MATCH_RESTART_DELAY_MS = 900;
const PARTIAL_NO_FINAL_RESTART_DELAY_MS = 1_200;
const CLIENT_ERROR_RESTART_DELAY_MS = 2_200;
const UNAVAILABLE_RESTART_DELAY_MS = 3_000;
const NO_MATCH_MAX_ERRORS = 3;
const MAX_LLM_RETRIES = 2;
const LLM_RETRY_DELAY_MS = 1_500;
const LLM_RATE_LIMIT_DELAY_MS = 2_000;

function classifyLLMError(error: unknown): { retryable: boolean; delayMs: number } {
  const msg = error instanceof Error ? error.message : String(error);
  // Auth / bad request — never retry, user must fix config
  if (msg.includes('invalid_api_key') || msg.includes('invalid_request_error') || msg.includes('"401"') || msg.includes('401')) {
    return { retryable: false, delayMs: 0 };
  }
  // Rate limit — retry after longer pause
  if (msg.includes('rate_limit') || msg.includes('429')) {
    return { retryable: true, delayMs: LLM_RATE_LIMIT_DELAY_MS };
  }
  // Network / timeout / server error — retry
  return { retryable: true, delayMs: LLM_RETRY_DELAY_MS };
}

interface EngineServices {
  stt: STTService;
  tts: TTSService;
  localLLM: LLMService;
  onlineLLM: LLMService;
  sessionRepo: SessionRepository;
  turnRepo: TurnRepository;
  summaryRepo: SummaryRepository;
}

export interface EngineResponse {
  text: string;
  status: 'completed' | 'interrupted';
}

export class ConversationEngine {
  state: ConversationState = 'idle';
  sttMode: 'online' | 'offline' = 'online';
  private context: ContextManager | null = null;
  private sessionId: number | null = null;
  private sessionMode: SessionMode = 'just-walk';
  private llmMode: LLMMode = 'local';
  private inputMode: InputMode = 'voice';
  private pendingModeSwitch: LLMMode | null = null;
  private onStateChange: ((state: ConversationState) => void) | null = null;
  private onStatusDetailChange: ((detail: string | null) => void) | null = null;
  private onSttModeChange: ((mode: 'online' | 'offline') => void) | null = null;
  private textStreamCallback: ((token: string) => void) | null = null;
  private sessionActive = false;
  private sttRestartTimer: ReturnType<typeof setTimeout> | null = null;
  private consecutiveSttErrors = 0;
  private generationToken = 0;

  constructor(private services: EngineServices) {}

  setOnStateChange(cb: (state: ConversationState) => void): void {
    this.onStateChange = cb;
  }

  setOnStatusDetailChange(cb: (detail: string | null) => void): void {
    this.onStatusDetailChange = cb;
  }

  setOnSttModeChange(cb: (mode: 'online' | 'offline') => void): void {
    this.onSttModeChange = cb;
  }

  async startIdle(): Promise<void> {
    console.log('[Engine] Entering idle state');
    this.setStatusDetail(null);
    this.setState('idle');
  }

  async startSession(mode: SessionMode, llmMode: LLMMode, inputMode: InputMode = 'voice'): Promise<void> {
    this.sessionMode = mode;
    this.llmMode = llmMode;
    this.inputMode = inputMode;
    this.sessionActive = true;
    this.sttMode = 'online';
    this.onSttModeChange?.('online');
    this.setStatusDetail(null);
    this.context = new ContextManager(mode);
    this.generationToken += 1;
    this.clearSTTRestartTimer();
    this.consecutiveSttErrors = 0;
    await this.services.stt.destroy().catch(() => {});
    this.sessionId = await this.services.sessionRepo.create({
      mode,
      startedAt: Date.now(),
      modelUsed: llmMode,
    });
    console.log('[Engine] Session started', {
      sessionId: this.sessionId,
      mode,
      llmMode,
      inputMode,
    });

    if (inputMode === 'voice') {
      this.services.stt.init({
        onResult: async (text) => {
          console.log('[Engine] Handling STT final result', {
            sessionId: this.sessionId,
            state: this.state,
            text,
          });
          await this.onUserSpeech(text);
        },
        onError: (error) => this.onSTTError(error),
      });
      this.startListening();
    } else {
      this.setState('idle');
    }
  }

  async endSession(): Promise<void> {
    console.log('[Engine] Ending session', { sessionId: this.sessionId });
    this.sessionActive = false;
    this.generationToken += 1;
    this.clearSTTRestartTimer();
    this.consecutiveSttErrors = 0;
    await this.services.stt.destroy().catch(() => {});
    this.services.tts.stop();
    if (this.sessionId) {
      const endedAt = Date.now();
      await this.services.sessionRepo.end(this.sessionId, endedAt);
      const turnCount = this.context?.getTurnCount() ?? 0;
      if (turnCount > 0) {
        this.generateSummaryWithTimeout(this.sessionId);
      }
    }
    this.sessionId = null;
    this.context = null;
    this.setStatusDetail(null);
    this.setState('idle');
    await this.startIdle();
  }

  async processTextInput(text: string, onToken?: (token: string) => void): Promise<EngineResponse> {
    if (!this.sessionId || !this.context) {
      throw new Error('No active session');
    }
    console.log('[Engine] Processing text input', {
      sessionId: this.sessionId,
      text,
      llmMode: this.llmMode,
      state: this.state,
    });
    this.textStreamCallback = onToken ?? null;
    try {
      return await this.onUserSpeech(text);
    } finally {
      this.textStreamCallback = null;
    }
  }

  toggleLLMMode(newMode: LLMMode): void {
    console.log('[Engine] Toggling LLM mode', {
      sessionId: this.sessionId,
      from: this.llmMode,
      to: newMode,
      state: this.state,
    });
    if (this.state === 'processing') {
      this.pendingModeSwitch = newMode;
    } else {
      this.llmMode = newMode;
    }
  }

  isByeNova(text: string): boolean {
    const trimmed = text.trim();
    const words = trimmed.split(/\s+/);

    // Utterance containing a bye word + "nova", up to 6 words
    // (covers natural closings like "all good thanks bye nova")
    if (words.length <= 6) {
      const hasBye = words.some(w => BYE_WORD.test(w));
      const hasNova = words.some(w => NOVA_WORD.test(w));
      if (hasBye && hasNova) return true;
    }

    return false;
  }

  private async switchToOfflineSTT(): Promise<void> {
    const available = await this.services.stt.isOnDeviceAvailable();
    if (available) {
      this.sttMode = 'offline';
      this.onSttModeChange?.('offline');
      console.log('[Engine] Switched to offline STT');
      this.setStatusDetail('Offline mode — accuracy may vary');
    } else {
      console.warn('[Engine] On-device STT not available on this device');
    }
  }

  private startListening(): void {
    if (!this.sessionActive) return;
    this.clearSTTRestartTimer();
    console.log('[Engine] Starting STT listening', { sessionId: this.sessionId, sttMode: this.sttMode });
    this.setState('listening');
    this.services.stt.startListening(this.sttMode === 'offline').catch(() => {});
  }

  private async onUserSpeech(text: string): Promise<EngineResponse> {
    if (!this.sessionActive) {
      return { text: '', status: 'completed' };
    }
    console.log('[Engine] Received user speech/text', {
      sessionId: this.sessionId,
      text,
    });
    this.setStatusDetail(null);
    this.consecutiveSttErrors = 0;
    this.clearSTTRestartTimer();
    await this.services.stt.stopListening();
    if (this.isByeNova(text)) {
      await this.endSession();
      return { text: '', status: 'completed' };
    }

    this.context!.addUserTurn(text);
    await this.services.turnRepo.add({
      sessionId: this.sessionId!,
      speaker: 'user',
      text,
      status: 'completed',
    });

    return this.generateResponse();
  }

  private async generateResponse(): Promise<EngineResponse> {
    const generationToken = this.generationToken;
    const activeSessionId = this.sessionId;
    const activeContext = this.context;

    if (!activeSessionId || !activeContext || !this.sessionActive) {
      return { text: '', status: 'completed' };
    }

    this.setState('processing');
    const messages = activeContext.getMessages();
    const llm = this.getActiveLLM();
    let fullResponse = '';
    let interrupted = false;
    let tokenCount = 0;

    console.log('[Engine] Starting response generation', {
      sessionId: this.sessionId,
      llmMode: this.llmMode,
      activeLLM: llm.constructor.name,
      messageCount: messages.length,
    });

    for (let attempt = 0; attempt <= MAX_LLM_RETRIES; attempt++) {
      fullResponse = '';
      interrupted = false;
      tokenCount = 0;
      let generationError: unknown = null;

      try {
        for await (const token of llm.generate(messages)) {
          fullResponse += token;
          tokenCount += 1;
          if (this.inputMode === 'voice') this.services.tts.feedToken(token);
          else this.textStreamCallback?.(token);
          if (!this.isGenerationCurrent(generationToken, activeSessionId, activeContext)) {
            console.log('[Engine] Discarding stale generation during stream', {
              sessionId: activeSessionId,
            });
            return { text: '', status: 'interrupted' };
          }
          if (this.state === 'listening') {
            interrupted = true;
            break;
          }
          if (this.inputMode === 'voice' && this.state !== 'speaking') this.setState('speaking');
        }
        if (this.inputMode === 'voice') {
          this.services.tts.flush();
          await this.services.tts.waitForIdle();
          await new Promise(resolve => setTimeout(resolve, TTS_TAIL_DELAY_MS));
        }
      } catch (error) {
        generationError = error;
      }

      if (!generationError) break; // success — exit retry loop

      const { retryable, delayMs } = classifyLLMError(generationError);
      const hasPartialTokens = fullResponse !== '';
      const isLastAttempt = attempt >= MAX_LLM_RETRIES;

      if (retryable && !hasPartialTokens && !isLastAttempt && this.isGenerationCurrent(generationToken, activeSessionId, activeContext)) {
        console.warn('[Engine] LLM generation failed, retrying', {
          sessionId: activeSessionId,
          attempt: attempt + 1,
          maxRetries: MAX_LLM_RETRIES,
          error: generationError,
        });
        this.setStatusDetail(`Retrying… (${attempt + 1}/${MAX_LLM_RETRIES})`);
        await new Promise(r => setTimeout(r, delayMs));
        if (!this.isGenerationCurrent(generationToken, activeSessionId, activeContext)) {
          return { text: '', status: 'interrupted' };
        }
        continue;
      }

      // All retries exhausted or non-retryable error
      console.error('[Engine] LLM generation failed:', generationError);
      if (this.inputMode === 'voice') this.services.tts.stop();
      if (this.isGenerationCurrent(generationToken, activeSessionId, activeContext)) {
        this.setStatusDetail("Couldn't get a response. Try again.");
        if (this.inputMode === 'voice') {
          this.sttRestartTimer = setTimeout(() => {
            this.sttRestartTimer = null;
            if (this.sessionActive) this.startListening();
          }, STT_RESTART_DELAY_MS);
        } else {
          this.setState('idle');
        }
      }
      return { text: '', status: 'interrupted' };
    }

    if (!this.isGenerationCurrent(generationToken, activeSessionId, activeContext)) {
      console.log('[Engine] Discarding stale generation after completion', {
        sessionId: activeSessionId,
      });
      return { text: '', status: 'interrupted' };
    }

    console.log('[Engine] Generation finished', {
      sessionId: activeSessionId,
      interrupted,
      tokenCount,
      responseChars: fullResponse.length,
    });

    if (!fullResponse.trim()) {
      console.warn('[Engine] Generation completed with empty response', {
        sessionId: activeSessionId,
        llmMode: this.llmMode,
        activeLLM: llm.constructor.name,
      });
    }

    activeContext.addAssistantTurn(fullResponse, interrupted);
    await this.services.turnRepo.add({
      sessionId: activeSessionId,
      speaker: 'ai',
      text: fullResponse,
      status: interrupted ? 'interrupted' : 'completed',
    });

    if (this.pendingModeSwitch) {
      this.llmMode = this.pendingModeSwitch;
      this.pendingModeSwitch = null;
    }

    if (this.inputMode === 'voice') {
      if (!interrupted) this.startListening();
    } else {
      this.setState('idle');
    }
    return {
      text: fullResponse,
      status: interrupted ? 'interrupted' : 'completed',
    };
  }

  private onSTTError(error: STTErrorInfo): void {
    const isActiveListeningError = this.sessionActive && this.state === 'listening';
    const isSoftNoMatch =
      error.kind === 'speech_timeout' ||
      (error.kind === 'no_match' && !error.partialText && !error.sawFinalResult);
    console.warn('[Engine] STT error', {
      sessionId: this.sessionId,
      state: this.state,
      consecutiveErrors: this.consecutiveSttErrors,
      kind: error.kind,
      code: error.code,
      partialText: error.partialText,
      sawFinalResult: error.sawFinalResult,
      message: error.message,
      ignored: !isActiveListeningError,
      countsAsFailure: !isSoftNoMatch,
    });
    if (!isActiveListeningError) return;

    if (!isSoftNoMatch) {
      this.consecutiveSttErrors += 1;
    }

    const policy = this.getSTTRetryPolicy(error);
    this.setStatusDetail(this.describeSTTError(error));
    if (!policy.retry || this.consecutiveSttErrors >= policy.maxErrors) {
      // On connectivity-related errors, try switching to offline STT before degrading
      if ((error.kind === 'network_error' || error.kind === 'unavailable') && this.sttMode === 'online') {
        this.switchToOfflineSTT().then(() => {
          this.consecutiveSttErrors = 0;
          this.setState('recovering');
          this.sttRestartTimer = setTimeout(() => {
            this.sttRestartTimer = null;
            if (this.sessionActive) this.startListening();
          }, 500);
        });
        return;
      }
      this.enterDegradedState(error);
      return;
    }

    this.setState('recovering');
    this.clearSTTRestartTimer();
    this.sttRestartTimer = setTimeout(() => {
      this.sttRestartTimer = null;
      if (!this.sessionActive || this.state !== 'recovering') {
        return;
      }
      if (this.services.stt.isListeningActive()) {
        console.log('[Engine] STT already active, skipping retry', {
          sessionId: this.sessionId,
          consecutiveErrors: this.consecutiveSttErrors,
          kind: error.kind,
          countsAsFailure: !isSoftNoMatch,
        });
        this.setState('listening');
        return;
      }
      console.log('[Engine] Restarting STT after backoff', {
        sessionId: this.sessionId,
        consecutiveErrors: this.consecutiveSttErrors,
        kind: error.kind,
        countsAsFailure: !isSoftNoMatch,
        delayMs: policy.delayMs,
      });
      this.startListening();
    }, policy.delayMs);
  }

  private async generateSummaryWithTimeout(sessionId: number): Promise<void> {
    // Wait for any in-progress local LLM completion to finish before starting
    // summary generation — llama.rn rejects concurrent completion calls.
    const llm = this.services.localLLM;
    if (llm.waitForIdle) {
      await Promise.race([
        llm.waitForIdle(),
        new Promise(r => setTimeout(r, 5_000)),
      ]);
    }

    const turns = await this.services.turnRepo.getForSession(sessionId);
    const transcript = turns
      .map(t => `${t.speaker === 'user' ? 'User' : 'Nova'}: ${t.text}`)
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
      if (!llm.isReady()) {
        await this.services.summaryRepo.save(sessionId, '');
        return;
      }

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), SUMMARY_TIMEOUT_MS),
      );

      let summary = '';
      const generationPromise = (async () => {
        for await (const token of llm.generate(summaryMessages)) {
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
    if (newState === this.state) {
      return;
    }
    console.log('[Engine] State transition', {
      sessionId: this.sessionId,
      from: this.state,
      to: newState,
    });
    if (newState === 'listening' || newState === 'processing' || newState === 'speaking' || newState === 'idle') {
      this.setStatusDetail(null);
    }
    this.state = newState;
    this.onStateChange?.(newState);
  }

  private getActiveLLM(): LLMService {
    const onlineReady = this.services.onlineLLM.isReady();
    console.log('[Engine] Resolving active LLM', {
      sessionId: this.sessionId,
      llmMode: this.llmMode,
      onlineReady,
    });
    if (this.llmMode === 'online' && onlineReady) {
      return this.services.onlineLLM;
    }
    return this.services.localLLM;
  }

  private clearSTTRestartTimer(): void {
    if (this.sttRestartTimer) {
      clearTimeout(this.sttRestartTimer);
      this.sttRestartTimer = null;
    }
  }

  private getSTTRetryPolicy(error: STTErrorInfo): {
    retry: boolean;
    delayMs: number;
    maxErrors: number;
  } {
    switch (error.kind) {
      case 'speech_timeout':
        // Normal silence during a walk — restart immediately, never degrade
        return { retry: true, delayMs: 300, maxErrors: Infinity };
      case 'no_match':
        return {
          retry: true,
          delayMs: NO_MATCH_RESTART_DELAY_MS,
          maxErrors: NO_MATCH_MAX_ERRORS,
        };
      case 'partial_no_final':
        return {
          retry: true,
          delayMs: PARTIAL_NO_FINAL_RESTART_DELAY_MS,
          maxErrors: MAX_CONSECUTIVE_STT_ERRORS,
        };
      case 'client_error':
        return {
          retry: true,
          delayMs: CLIENT_ERROR_RESTART_DELAY_MS,
          maxErrors: MAX_CONSECUTIVE_STT_ERRORS,
        };
      case 'network_error':
        // maxErrors: 2 — allows one transient disconnect (e.g. audio focus race
        // after TTS on Samsung) to retry before entering degraded state.
        return {
          retry: true,
          delayMs: UNAVAILABLE_RESTART_DELAY_MS,
          maxErrors: 2,
        };
      case 'unavailable':
        return {
          retry: true,
          delayMs: UNAVAILABLE_RESTART_DELAY_MS,
          maxErrors: 2,
        };
      case 'unknown':
      default:
        return {
          retry: true,
          delayMs: STT_RESTART_DELAY_MS,
          maxErrors: 2,
        };
    }
  }

  private describeSTTError(error: STTErrorInfo): string {
    switch (error.kind) {
      case 'speech_timeout':
        return 'Listening...';
      case 'no_match':
        return 'Did not catch that. Listening again.';
      case 'partial_no_final':
        return 'Heard part of that. Trying again.';
      case 'client_error':
        return 'Mic is resetting. Retrying shortly.';
      case 'network_error':
        return 'Speech service network issue.';
      case 'unavailable':
        return 'Speech service unavailable right now.';
      case 'unknown':
      default:
        return 'Voice input had a problem.';
    }
  }

  private setStatusDetail(detail: string | null): void {
    this.onStatusDetailChange?.(detail);
  }

  private enterDegradedState(error: STTErrorInfo): void {
    console.warn('[Engine] Too many consecutive STT errors, entering degraded state', {
      sessionId: this.sessionId,
      consecutiveErrors: this.consecutiveSttErrors,
      kind: error.kind,
    });
    this.clearSTTRestartTimer();
    this.services.stt.stopListening().catch(() => {});
    this.setState('degraded');
  }

  private isGenerationCurrent(
    generationToken: number,
    sessionId: number,
    context: ContextManager,
  ): boolean {
    return (
      this.generationToken === generationToken &&
      this.sessionActive &&
      this.sessionId === sessionId &&
      this.context === context
    );
  }
}
