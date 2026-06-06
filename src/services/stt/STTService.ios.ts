import Voice, { SpeechResultsEvent, SpeechErrorEvent } from '@react-native-voice/voice';
import { STTErrorInfo, STTErrorKind } from '../../types';

// Supported locales for SFSpeechRecognizer — keep en-US as safe default.
// Intl may return a region that SFSpeechRecognizer doesn't support on
// a given OS version (e.g. en-IN on iPadOS 26 beta), so we normalise to
// the base language with a known-good region.
const IOS_LOCALE_MAP: Record<string, string> = {
  en: 'en-US',
  hi: 'hi-IN',
  fr: 'fr-FR',
  de: 'de-DE',
  es: 'es-ES',
  zh: 'zh-CN',
  ja: 'ja-JP',
  ko: 'ko-KR',
  pt: 'pt-BR',
  ar: 'ar-SA',
};

function getLocale(): string {
  try {
    const raw = Intl.DateTimeFormat().resolvedOptions().locale ?? '';
    if (raw) {
      const lang = raw.split('-')[0].toLowerCase();
      const mapped = IOS_LOCALE_MAP[lang];
      if (mapped) return mapped;
      // Return the raw locale if not in the map — may still work
      return raw;
    }
  } catch {}
  return 'en-US';
}

// iOS Voice errors always have code="recognition_fail".
// The message encodes the NSError code as "NSCODE/description".
// Map the numeric NSError code to our error kind.
function mapIOSError(message: string): STTErrorKind {
  const numericCode = parseInt(message.split('/')[0] ?? '', 10);
  // Network-related NSURLError codes
  if (numericCode === -1009 || numericCode === -1001 || numericCode === -1004) {
    return 'network_error';
  }
  // Not authorized or unsupported locale
  if (numericCode === 1 || numericCode === 2) {
    return 'unavailable';
  }
  // Default: treat as no_match (retried gracefully by the engine)
  return 'no_match';
}

export class STTService {
  private listening = false;
  private resultDispatched = false;
  private onResultCb: ((text: string) => void | Promise<void>) | null = null;
  private onErrorCb: ((error: STTErrorInfo) => void) | null = null;

  init(callbacks: {
    onResult: (text: string) => void | Promise<void>;
    onError: (error: STTErrorInfo) => void;
  }): void {
    this.onResultCb = callbacks.onResult;
    this.onErrorCb = callbacks.onError;

    Voice.onSpeechResults = (event: SpeechResultsEvent) => {
      this.listening = false;
      this.resultDispatched = true;
      const text = (event.value?.[0] ?? '').trim();
      console.log('[STT][iOS] onSpeechResults:', text);
      if (text) {
        if (this.onResultCb) {
          Promise.resolve(this.onResultCb(text)).catch(e =>
            console.error('[STT][iOS] Result callback failed', e),
          );
        }
      } else {
        this.onErrorCb?.({
          kind: 'no_match',
          message: 'No speech detected',
          sawFinalResult: true,
        });
      }
    };

    Voice.onSpeechPartialResults = (event: SpeechResultsEvent) => {
      const partial = event.value?.[0] ?? '';
      if (partial) console.log('[STT][iOS] partial:', partial);
    };

    Voice.onSpeechError = (event: SpeechErrorEvent) => {
      this.listening = false;
      // iOS always sends code="recognition_fail"; numeric error is in the message.
      const message = event.error?.message ?? '';
      console.warn('[STT][iOS] onSpeechError:', { message });
      if (this.resultDispatched) {
        console.log('[STT][iOS] Suppressing post-result error');
        return;
      }
      this.onErrorCb?.({
        kind: mapIOSError(message),
        message,
        code: 'recognition_fail',
        sawFinalResult: false,
      });
    };

    Voice.onSpeechEnd = () => {
      console.log('[STT][iOS] onSpeechEnd');
      this.listening = false;
    };

    console.log('[STT][iOS] Initialized native Voice STT');
  }

  // iOS v3.2.4 does not export isOnDeviceRecognitionAvailable.
  // Offline STT is a follow-up (requires patching the native module).
  async isOnDeviceAvailable(): Promise<boolean> {
    return false;
  }

  // No model to download on iOS — recognition models ship with the OS.
  async triggerOnDeviceModelDownload(): Promise<boolean> {
    return false;
  }

  async startListening(_useOnDevice = false): Promise<void> {
    if (this.listening) {
      console.log('[STT][iOS] Already listening, skipping');
      return;
    }
    this.listening = true;
    this.resultDispatched = false;
    const locale = getLocale();
    console.log('[STT][iOS] startListening', { locale });
    try {
      // iOS startSpeech accepts only locale — options are ignored by the native module.
      await Voice.start(locale);
    } catch (error) {
      this.listening = false;
      console.error('[STT][iOS] Voice.start() failed:', error);
      try {
        await Voice.cancel();
        await new Promise(resolve => setTimeout(resolve, 100));
        this.resultDispatched = false;
        await Voice.start(locale);
        this.listening = true;
      } catch (retryError) {
        console.error('[STT][iOS] Voice.start() retry failed:', retryError);
        this.onErrorCb?.({
          kind: 'client_error',
          message: retryError instanceof Error ? retryError.message : 'Failed to start STT',
          sawFinalResult: false,
        });
      }
    }
  }

  async stopListening(): Promise<void> {
    console.log('[STT][iOS] stopListening');
    this.listening = false;
    try {
      await Voice.stop();
    } catch (e) {
      console.warn('[STT][iOS] Voice.stop() failed:', e);
    }
  }

  async destroy(): Promise<void> {
    console.log('[STT][iOS] destroy');
    this.listening = false;
    try {
      await Voice.destroy();
    } catch (e) {
      console.warn('[STT][iOS] Voice.destroy() failed:', e);
    }
    Voice.removeAllListeners();
    this.onResultCb = null;
    this.onErrorCb = null;
  }

  isListeningActive(): boolean {
    return this.listening;
  }
}
