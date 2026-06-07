import Tts from 'react-native-tts';

// Exported for testing
export function splitIntoSentences(text: string): string[] {
  if (!text.trim()) return [];
  // Split after punctuation that follows either:
  //   [a-z][.!?]     — lowercase letter before punctuation (2 chars, fixed)
  //   [A-Z]{2}[.!?]  — two consecutive uppercase letters before punctuation (3 chars, fixed)
  // The second alternative handles proper nouns and acronyms ending sentences
  // (e.g. "NASA. Next…" splits, but "U.S. is…" does not because only one
  // uppercase letter precedes each period in that abbreviation).
  // Both alternatives are fixed-length, satisfying Hermes's lookbehind constraint.
  const parts = text.split(/(?<=[a-z][.!?]|[A-Z]{2}[.!?])\s+/);
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

  async setRate(rate: number): Promise<void> {
    try {
      await Tts.setDefaultRate(rate, false);
    } catch (e) {
      console.warn('[TTS] setRate failed:', e);
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
      });
    } catch (error) {
      console.warn('[TTS] speak failed:', error);
      this.pendingUtterances = Math.max(0, this.pendingUtterances - 1);
      this.resolveIdleWaiters();
    }
  }

  private safeStop(): void {
    if (!this.ready) return;
    try {
      Promise.resolve(Tts.stop()).catch((error) => {
        console.warn('[TTS] stop failed:', error);
      });
    } catch (error) {
      console.warn('[TTS] stop failed:', error);
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

    // 'tts-error' is not a supported event on iOS (react-native-tts v4);
    // registering it crashes the TurboModule bridge. Errors surface via
    // the rejected Promise from safeSpeak instead.
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
