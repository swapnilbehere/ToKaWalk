import Tts from 'react-native-tts';

// Exported for testing
export function splitIntoSentences(text: string): string[] {
  if (!text.trim()) return [];
  // Only split after punctuation that follows a lowercase letter.
  // This prevents splitting on abbreviations like U.S. or Dr. where
  // the letter before the period is uppercase.
  const parts = text.split(/(?<=[a-z][.!?])\s+/);
  return parts.map(s => s.trim()).filter(Boolean);
}

const MIN_FLUSH_TOKENS = 8;

export class TTSService {
  private buffer = '';
  private tokenCount = 0;
  private ready = false;
  private pendingUtterances = 0;
  private idleWaiters: Array<() => void> = [];
  private listenersAttached = false;

  async init(rate: number): Promise<void> {
    await Tts.getInitStatus();
    try {
      // New Arch (RN 0.82+) cannot bridge JS boolean → Obj-C BOOL for legacy
      // NativeModules, so this call throws on iOS. Non-fatal: TTS still works
      // at default rate.
      await Tts.setDefaultRate(rate, false);
    } catch (e) {
      console.warn('[TTS] setDefaultRate failed, using default rate:', e);
    }
    this.attachListeners();
    this.ready = true;
  }

  feedToken(token: string): void {
    if (!this.ready) return;
    this.buffer += token;
    this.tokenCount++;

    const sentences = splitIntoSentences(this.buffer);
    if (sentences.length > 1 && this.tokenCount >= MIN_FLUSH_TOKENS) {
      const complete = sentences.slice(0, -1);
      this.buffer = sentences[sentences.length - 1];
      this.tokenCount = 0;
      complete.forEach(s => this.safeSpeak(s));
    }
  }

  flush(): void {
    if (!this.ready) return;
    if (this.buffer.trim()) {
      this.safeSpeak(this.buffer.trim());
      this.buffer = '';
      this.tokenCount = 0;
    }
  }

  async waitForIdle(): Promise<void> {
    if (!this.ready || this.pendingUtterances === 0) return;
    await new Promise<void>((resolve) => {
      this.idleWaiters.push(resolve);
    });
  }

  stop(): void {
    this.safeStop();
    this.buffer = '';
    this.tokenCount = 0;
    this.pendingUtterances = 0;
    this.resolveIdleWaiters();
  }

  private safeSpeak(text: string): void {
    try {
      this.pendingUtterances += 1;
      Promise.resolve(Tts.speak(text)).catch((error) => {
        console.warn('[TTS] speak failed:', error);
        this.pendingUtterances = Math.max(0, this.pendingUtterances - 1);
        this.resolveIdleWaiters();
        this.ready = false;
      });
    } catch (error) {
      console.warn('[TTS] speak failed:', error);
      this.pendingUtterances = Math.max(0, this.pendingUtterances - 1);
      this.resolveIdleWaiters();
      this.ready = false;
    }
  }

  private safeStop(): void {
    if (!this.ready) return;
    try {
      Promise.resolve(Tts.stop()).catch((error) => {
        console.warn('[TTS] stop failed:', error);
        this.ready = false;
      });
    } catch (error) {
      console.warn('[TTS] stop failed:', error);
      this.ready = false;
    }
  }

  private attachListeners(): void {
    if (this.listenersAttached) return;
    this.listenersAttached = true;

    Tts.addEventListener('tts-start', (event) => {
      console.log('[TTS] start', event);
    });

    Tts.addEventListener('tts-finish', (event) => {
      console.log('[TTS] finish', event);
      this.onUtteranceComplete();
    });

    Tts.addEventListener('tts-cancel', (event) => {
      console.log('[TTS] cancel', event);
      this.onUtteranceComplete();
    });

    Tts.addEventListener('tts-error', (event) => {
      console.warn('[TTS] error', event);
      this.onUtteranceComplete();
    });
  }

  private onUtteranceComplete(): void {
    this.pendingUtterances = Math.max(0, this.pendingUtterances - 1);
    this.resolveIdleWaiters();
  }

  private resolveIdleWaiters(): void {
    if (this.pendingUtterances !== 0) return;
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    waiters.forEach(resolve => resolve());
  }
}
