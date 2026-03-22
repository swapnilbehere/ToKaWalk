import Voice, { SpeechResultsEvent, SpeechErrorEvent } from '@react-native-voice/voice';

export class STTService {
  private onResult: ((text: string) => void) | null = null;
  private onError: ((error: string) => void) | null = null;

  init(callbacks: { onResult: (text: string) => void; onError: (error: string) => void }): void {
    this.onResult = callbacks.onResult;
    this.onError = callbacks.onError;

    Voice.onSpeechResults = (event: SpeechResultsEvent) => {
      const text = event.value?.[0] ?? '';
      if (text && this.onResult) this.onResult(text);
    };

    Voice.onSpeechError = (event: SpeechErrorEvent) => {
      if (this.onError) this.onError(event.error?.message ?? 'STT error');
    };
  }

  async startListening(): Promise<void> {
    await Voice.start('en-US');
  }

  async stopListening(): Promise<void> {
    await Voice.stop();
  }

  async destroy(): Promise<void> {
    await Voice.destroy();
    Voice.removeAllListeners();
  }
}
