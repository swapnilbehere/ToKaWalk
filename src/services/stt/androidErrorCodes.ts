import { STTErrorKind } from '../../types';

/**
 * Android `SpeechRecognizer` error code -> {@link STTErrorKind}.
 *
 * The ConversationEngine's recovery path branches on the kind: `speech_timeout`
 * and a clean `no_match` are soft (retry, never count toward "degraded"),
 * `network_error` / `unavailable` can trigger a switch to offline STT, and
 * `client_error` counts toward the degraded limit. A wrong mapping either
 * wedges the mic or degrades too eagerly, so this lives in its own pure module
 * and is unit-tested directly.
 */
export function mapErrorCode(code: string): STTErrorKind {
  switch (code) {
    case '1': // ERROR_NETWORK_TIMEOUT
    case '2': // ERROR_NETWORK
      return 'network_error';
    case '11': // ERROR_SERVER_DISCONNECTED — on Samsung fires as a transient
      // recognizer lifecycle reset (not a real network failure); treat as soft
      // timeout so it never counts toward the degraded limit.
      return 'speech_timeout';
    case '3': // ERROR_AUDIO
    case '5': // ERROR_CLIENT
    case '8': // ERROR_RECOGNIZER_BUSY
    case '10': // ERROR_TOO_MANY_REQUESTS
      return 'client_error';
    case '4': // ERROR_SERVER
    case '9': // ERROR_INSUFFICIENT_PERMISSIONS
    case '12': // ERROR_LANGUAGE_NOT_SUPPORTED
    case '13': // ERROR_LANGUAGE_UNAVAILABLE
    case '14': // ERROR_CANNOT_CHECK_SUPPORT
    case '15': // ERROR_CANNOT_LISTEN_TO_DOWNLOAD_EVENTS
      return 'unavailable';
    case '6': // ERROR_SPEECH_TIMEOUT (~10s of silence)
      return 'speech_timeout';
    case '7': // ERROR_NO_MATCH
      return 'no_match';
    default:
      return 'unknown';
  }
}
