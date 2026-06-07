import Voice, { SpeechResultsEvent, SpeechErrorEvent } from '@react-native-voice/voice';
import { NativeModules, Platform } from 'react-native';
import { STTErrorInfo, STTErrorKind, VADSensitivity } from '../../types';

function getDeviceLocale(): string {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    if (locale) return locale;
  } catch {}
  if (Platform.OS === 'android') {
    return NativeModules.I18nManager?.localeIdentifier?.replace('_', '-') ?? 'en-US';
  }
  return 'en-US';
}

// Android SpeechRecognizer error code → STTErrorKind
function mapErrorCode(code: string): STTErrorKind {
  switch (code) {
    case '1':  // ERROR_NETWORK_TIMEOUT
    case '2':  // ERROR_NETWORK
      return 'network_error';
    case '11': // ERROR_SERVER_DISCONNECTED — on Samsung fires as a transient
               // recognizer lifecycle reset (not a real network failure); treat
               // as soft timeout so it never counts toward the degraded limit.
      return 'speech_timeout';
    case '3':  // ERROR_AUDIO
    case '5':  // ERROR_CLIENT
    case '8':  // ERROR_RECOGNIZER_BUSY
    case '10': // ERROR_TOO_MANY_REQUESTS
      return 'client_error';
    case '4':  // ERROR_SERVER
    case '9':  // ERROR_INSUFFICIENT_PERMISSIONS
    case '12': // ERROR_LANGUAGE_NOT_SUPPORTED
    case '13': // ERROR_LANGUAGE_UNAVAILABLE
    case '14': // ERROR_CANNOT_CHECK_SUPPORT
    case '15': // ERROR_CANNOT_LISTEN_TO_DOWNLOAD_EVENTS
      return 'unavailable';
    case '6':  // ERROR_SPEECH_TIMEOUT (~10s of silence)
      return 'speech_timeout';
    case '7':  // ERROR_NO_MATCH
      return 'no_match';
    default:
      return 'unknown';
  }
}

export class STTService {
  private listening = false;
  private resultDispatched = false;
  private onResultCb: ((text: string) => void | Promise<void>) | null = null;
  private onErrorCb: ((error: STTErrorInfo) => void) | null = null;
  private vadSensitivity: VADSensitivity = 'indoor';

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
      console.log('[STT] onSpeechResults:', text);
      if (text) {
        if (this.onResultCb) {
          Promise.resolve(this.onResultCb(text)).catch(e =>
            console.error('[STT] Result callback failed', e),
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
      if (partial) console.log('[STT] partial:', partial);
    };

    Voice.onSpeechError = (event: SpeechErrorEvent) => {
      this.listening = false;
      const code = String(event.error?.code ?? '');
      const message = event.error?.message ?? 'STT error';
      console.warn('[STT] onSpeechError:', { code, message });
      // Suppress errors that arrive after a result was already dispatched —
      // these are side effects of Voice.stop() being called post-result.
      if (this.resultDispatched) {
        console.log('[STT] Suppressing post-result error', { code });
        return;
      }
      this.onErrorCb?.({
        kind: mapErrorCode(code),
        message,
        code,
        sawFinalResult: false,
      });
    };

    // onSpeechEnd fires when VAD detects silence (before onSpeechResults/onSpeechError).
    // Only used here for state tracking — do not dispatch errors from it.
    Voice.onSpeechEnd = () => {
      console.log('[STT] onSpeechEnd');
      this.listening = false;
    };

    console.log('[STT] Initialized native Voice STT');
  }

  async isOnDeviceAvailable(): Promise<boolean> {
    try {
      return await Voice.isOnDeviceRecognitionAvailable();
    } catch {
      return false;
    }
  }

  async triggerOnDeviceModelDownload(): Promise<boolean> {
    try {
      return await Voice.triggerModelDownload();
    } catch (e) {
      console.warn('[STT] triggerModelDownload failed:', e);
      return false;
    }
  }

  async startListening(useOnDevice = false): Promise<void> {
    if (this.listening) {
      console.log('[STT] Already listening, skipping');
      return;
    }
    this.listening = true;
    this.resultDispatched = false;
    const opts = useOnDevice
      ? { RECOGNIZER_ENGINE: 'ON_DEVICE', EXTRA_PREFER_OFFLINE: true }
      : {};
    const vadOpts = this.vadSensitivity === 'outdoor'
      ? { EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS: 2500, EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: 2500 }
      : {};
    const mergedOpts = { ...opts, ...vadOpts };
    const locale = useOnDevice ? getDeviceLocale() : 'en-US';
    console.log('[STT] startListening', { useOnDevice, locale, vadSensitivity: this.vadSensitivity });
    try {
      await Voice.start(locale, mergedOpts);
    } catch (error) {
      this.listening = false;
      console.error('[STT] Voice.start() failed:', error);
      // Cancel any stuck session and retry once
      try {
        await Voice.cancel();
        await new Promise(resolve => setTimeout(resolve, 100));
        await Voice.start(locale, mergedOpts);
        this.listening = true;
      } catch (retryError) {
        console.error('[STT] Voice.start() retry failed:', retryError);
        this.onErrorCb?.({
          kind: 'client_error',
          message: retryError instanceof Error ? retryError.message : 'Failed to start STT',
          sawFinalResult: false,
        });
      }
    }
  }

  async stopListening(): Promise<void> {
    console.log('[STT] stopListening');
    this.listening = false;
    try {
      await Voice.stop();
    } catch (e) {
      console.warn('[STT] Voice.stop() failed:', e);
    }
  }

  async destroy(): Promise<void> {
    console.log('[STT] destroy');
    this.listening = false;
    try {
      await Voice.destroy();
      Voice.removeAllListeners();
    } catch (e) {
      console.warn('[STT] Voice.destroy() failed:', e);
    }
    this.onResultCb = null;
    this.onErrorCb = null;
  }

  isListeningActive(): boolean {
    return this.listening;
  }

  setVadSensitivity(mode: VADSensitivity): void {
    this.vadSensitivity = mode;
    console.log('[STT][Android] VAD sensitivity set to', mode);
  }
}
