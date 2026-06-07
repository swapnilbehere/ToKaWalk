import Voice, { SpeechResultsEvent, SpeechErrorEvent } from '@react-native-voice/voice';
import { STTErrorInfo, STTErrorKind, VADSensitivity } from '../../types';

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

// How long to wait after the last speech segment before committing the
// accumulated text.  SFSpeechRecognizer fires onSpeechResults after ~1 s of
// silence; we restart immediately and wait this long before deciding the user
// is truly done speaking.
const CONTINUOUS_COMMIT_DELAY_MS = 1200;

function getLocale(): string {
  try {
    const raw = Intl.DateTimeFormat().resolvedOptions().locale ?? '';
    if (raw) {
      const lang = raw.split('-')[0].toLowerCase();
      const mapped = IOS_LOCALE_MAP[lang];
      if (mapped) return mapped;
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
  if (numericCode === -1009 || numericCode === -1001 || numericCode === -1004) {
    return 'network_error';
  }
  if (numericCode === 1 || numericCode === 2) {
    return 'unavailable';
  }
  return 'no_match';
}

export class STTService {
  private listening = false;
  private resultDispatched = false;
  private onResultCb: ((text: string) => void | Promise<void>) | null = null;
  private onErrorCb: ((error: STTErrorInfo) => void) | null = null;

  // Continuous-listening state: accumulate segments until commitDelayMs of silence
  // so iOS's ~1 s internal cutoff doesn't truncate mid-sentence.
  private accumulatedText = '';
  private commitTimer: ReturnType<typeof setTimeout> | null = null;
  private commitDelayMs = 1200;

  init(callbacks: {
    onResult: (text: string) => void | Promise<void>;
    onError: (error: STTErrorInfo) => void;
  }): void {
    this.onResultCb = callbacks.onResult;
    this.onErrorCb = callbacks.onError;

    Voice.onSpeechResults = (event: SpeechResultsEvent) => {
      this.listening = false;
      const text = (event.value?.[0] ?? '').trim();
      console.log('[STT][iOS] onSpeechResults:', text, { accumulated: this.accumulatedText });

      if (!text) {
        // No new text in this segment — commit whatever was accumulated, or
        // report no_match if there's nothing.
        if (this.accumulatedText) {
          this.commitAccumulated();
        } else {
          this.resultDispatched = true;
          this.onErrorCb?.({
            kind: 'no_match',
            message: 'No speech detected',
            sawFinalResult: true,
          });
        }
        return;
      }

      // Append to accumulated text.
      this.accumulatedText = this.accumulatedText ? `${this.accumulatedText} ${text}` : text;

      // Reset the commit timer — we got new speech, wait longer.
      this.clearCommitTimer();
      this.commitTimer = setTimeout(() => {
        this.commitTimer = null;
        this.commitAccumulated();
      }, this.commitDelayMs);

      // Restart immediately so we capture what the user says next.
      this.restartForContinuous();
    };

    Voice.onSpeechPartialResults = (event: SpeechResultsEvent) => {
      const partial = event.value?.[0] ?? '';
      if (partial) console.log('[STT][iOS] partial:', partial);
    };

    Voice.onSpeechError = (event: SpeechErrorEvent) => {
      this.listening = false;
      const message = event.error?.message ?? '';
      console.warn('[STT][iOS] onSpeechError:', { message, accumulated: this.accumulatedText });

      if (this.resultDispatched) {
        console.log('[STT][iOS] Suppressing post-result error');
        return;
      }

      // If we have accumulated text and the restart after a segment failed,
      // commit what we have rather than losing it.
      if (this.accumulatedText) {
        console.log('[STT][iOS] Error during continuous restart — committing accumulated text');
        this.commitAccumulated();
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
  async isOnDeviceAvailable(): Promise<boolean> {
    return false;
  }

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
    this.accumulatedText = '';
    this.clearCommitTimer();
    const locale = getLocale();
    console.log('[STT][iOS] startListening', { locale });
    try {
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
    this.clearCommitTimer();
    this.accumulatedText = '';
    try {
      await Voice.stop();
    } catch (e) {
      console.warn('[STT][iOS] Voice.stop() failed:', e);
    }
  }

  async destroy(): Promise<void> {
    console.log('[STT][iOS] destroy');
    this.listening = false;
    this.clearCommitTimer();
    this.accumulatedText = '';
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

  setVadSensitivity(mode: VADSensitivity): void {
    this.commitDelayMs = mode === 'outdoor' ? 2000 : 1200;
    console.log('[STT][iOS] VAD sensitivity set to', mode, '→', this.commitDelayMs, 'ms');
  }

  private commitAccumulated(): void {
    const text = this.accumulatedText.trim();
    this.accumulatedText = '';
    this.clearCommitTimer();
    if (!text) return;
    this.resultDispatched = true;
    console.log('[STT][iOS] Committing accumulated text:', text);
    if (this.onResultCb) {
      Promise.resolve(this.onResultCb(text)).catch(e =>
        console.error('[STT][iOS] Result callback failed', e),
      );
    }
  }

  private clearCommitTimer(): void {
    if (this.commitTimer) {
      clearTimeout(this.commitTimer);
      this.commitTimer = null;
    }
  }

  // Restart recognition immediately after a segment ends so we can capture
  // the rest of the sentence.  Errors here are handled in onSpeechError.
  private async restartForContinuous(): Promise<void> {
    const locale = getLocale();
    console.log('[STT][iOS] Continuous restart', { locale });
    try {
      await Voice.cancel();
      await new Promise(resolve => setTimeout(resolve, 80));
      await Voice.start(locale);
      this.listening = true;
      // Keep resultDispatched = false so errors during this segment are not
      // suppressed.
    } catch (error) {
      console.warn('[STT][iOS] Continuous restart failed:', error);
      // onSpeechError will fire and handle the commit.
    }
  }
}
