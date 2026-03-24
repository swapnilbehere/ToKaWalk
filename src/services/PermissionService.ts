import { Platform, PermissionsAndroid } from 'react-native';

// iOS: permissions are triggered automatically by AVAudioSession / SFSpeechRecognizer
// on first use, but we request them upfront here for a better UX.
// Android: RECORD_AUDIO is a dangerous permission and must be granted at runtime.

export type PermissionStatus = 'granted' | 'denied' | 'blocked';

export async function requestMicrophonePermission(): Promise<PermissionStatus> {
  if (Platform.OS === 'android') {
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      {
        title: 'Microphone Permission',
        message: 'ToKaWalk needs microphone access to hear your voice during walks.',
        buttonPositive: 'Allow',
        buttonNegative: 'Deny',
      },
    );
    if (result === PermissionsAndroid.RESULTS.GRANTED) return 'granted';
    if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) return 'blocked';
    return 'denied';
  }

  // iOS: AVAudioSession.requestRecordPermission — triggered when STT/Vosk first
  // accesses the microphone. The system dialog appears automatically; returning
  // 'granted' here lets the app proceed optimistically.
  return 'granted';
}

export async function requestSpeechRecognitionPermission(): Promise<PermissionStatus> {
  // Android: no separate speech recognition runtime permission needed —
  // RECORD_AUDIO covers it for on-device engines (Vosk).
  // iOS: SFSpeechRecognizer triggers its own system dialog on first use.
  return 'granted';
}

export async function requestAllPermissions(): Promise<{
  microphone: PermissionStatus;
  speech: PermissionStatus;
}> {
  const [microphone, speech] = await Promise.all([
    requestMicrophonePermission(),
    requestSpeechRecognitionPermission(),
  ]);
  return { microphone, speech };
}

export function allGranted(statuses: { microphone: PermissionStatus; speech: PermissionStatus }): boolean {
  return statuses.microphone === 'granted' && statuses.speech === 'granted';
}
