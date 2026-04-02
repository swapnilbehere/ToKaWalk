import Vosk from 'react-native-vosk';
import { STTErrorInfo } from '../../types';

export class STTService {
  private vosk: Vosk | null = null;
  private modelLoaded = false;
  private listening = false;
  private resultListener: { remove: () => void } | null = null;
  private finalResultListener: { remove: () => void } | null = null;
  private errorListener: { remove: () => void } | null = null;
  private onResultCb: ((text: string) => void | Promise<void>) | null = null;
  private onErrorCb: ((error: STTErrorInfo) => void) | null = null;

  constructor(private modelPath: string) {}

  init(callbacks: {
    onResult: (text: string) => void | Promise<void>;
    onError: (error: STTErrorInfo) => void;
  }): void {
    this.onResultCb = callbacks.onResult;
    this.onErrorCb = callbacks.onError;
    console.log('[STT] Initialized Vosk STT');
  }

  async startListening(): Promise<void> {
    if (this.listening) {
      console.log('[STT] Already listening, skipping');
      return;
    }

    console.log('[STT] startListening');

    try {
      if (!this.vosk || !this.modelLoaded) {
        console.log('[STT] Loading Vosk model', { path: this.modelPath });
        this.vosk = new Vosk();
        await this.vosk.loadModel(this.modelPath);
        this.modelLoaded = true;
        console.log('[STT] Vosk model loaded');
      }

      this.removeListeners();

      // Start recording first, then attach listeners (per react-native-vosk contract)
      await this.vosk.start({});
      this.listening = true;
      console.log('[STT] Vosk listening started');

      // onPartialResult = live partials while speaking {"partial":"..."}
      this.resultListener = this.vosk.onPartialResult((result: string) => {
        try {
          const partial = (JSON.parse(result).partial ?? '').trim();
          if (partial) console.log('[STT] Vosk partial:', partial);
        } catch { /* ignore malformed */ }
      });

      // onResult = end-of-utterance (VAD silence detected), has {"text":"..."}
      // onFinalResult = fires when stop() is called explicitly, also has {"text":"..."}
      const handleFinalText = (result: string, source: string) => {
        console.log(`[STT] Vosk ${source} raw:`, result);
        this.listening = false;
        this.removeListeners();

        try {
          const text = this.extractText(result);
          if (text) {
            console.log('[STT] Vosk dispatching result:', { text });
            if (this.onResultCb) {
              Promise.resolve(this.onResultCb(text)).catch(e =>
                console.error('[STT] Result callback failed', e),
              );
            }
          } else {
            console.log('[STT] Vosk empty result — no speech detected');
            this.onErrorCb?.({
              kind: 'no_match',
              message: 'No speech detected',
              sawFinalResult: false,
            });
          }
        } catch (e) {
          console.error('[STT] Failed to parse Vosk result', e);
          this.onErrorCb?.({
            kind: 'unknown',
            message: 'Failed to parse Vosk result',
            sawFinalResult: false,
          });
        } finally {
          try {
            this.vosk?.stop();
          } catch (e) {
            console.warn('[STT] Vosk stop after result failed', e);
          }
        }
      };

      this.finalResultListener = this.vosk.onResult((result: string) =>
        handleFinalText(result, 'onResult'),
      );

      this.errorListener = this.vosk.onError((error: string) => {
        console.error('[STT] Vosk native error:', error);
        this.listening = false;
        this.removeListeners();
        this.onErrorCb?.({
          kind: 'unavailable',
          message: error ?? 'Vosk native error',
          sawFinalResult: false,
        });
      });

    } catch (error) {
      this.listening = false;
      console.error('[STT] Failed to start Vosk', error);
      this.onErrorCb?.({
        kind: 'unavailable',
        message: error instanceof Error ? error.message : 'Failed to start Vosk STT',
        sawFinalResult: false,
      });
    }
  }

  async stopListening(): Promise<void> {
    console.log('[STT] stopListening');
    this.listening = false;
    this.removeListeners();
    try {
      this.vosk?.stop();
    } catch (e) {
      console.warn('[STT] Vosk stop failed', e);
    }
  }

  async destroy(): Promise<void> {
    console.log('[STT] destroy');
    this.listening = false;
    this.removeListeners();
    try {
      this.vosk?.stop();
    } catch { /* ignore */ }
    this.vosk = null;
    this.modelLoaded = false;
  }

  isListeningActive(): boolean {
    return this.listening;
  }

  private removeListeners(): void {
    this.resultListener?.remove();
    this.finalResultListener?.remove();
    this.errorListener?.remove();
    this.resultListener = null;
    this.finalResultListener = null;
    this.errorListener = null;
  }

  private extractText(result: string): string {
    const trimmed = result.trim();
    if (!trimmed) return '';

    if (!trimmed.startsWith('{')) {
      return trimmed;
    }

    return (JSON.parse(trimmed).text ?? '').trim();
  }
}
