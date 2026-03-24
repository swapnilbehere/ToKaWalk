import Vosk from 'react-native-vosk';

// Wake word detection using Vosk offline speech recognition.
//
// Model: vosk-model-small-en-us-0.15 (~40MB)
// Download from: https://alphacephei.com/vosk/models
// Extract to device documents directory before first use.
// Path is passed in as modelPath (provided by useConversationEngine).
//
// Grammar mode restricts Vosk to only the wake phrase + [unk],
// making it efficient enough for always-on use.

const HEY_TOKA_GRAMMAR = ['hey toka', '[unk]'];

export class WakeWordService {
  private vosk: Vosk | null = null;
  private resultListener: { remove: () => void } | null = null;
  private finalResultListener: { remove: () => void } | null = null;

  constructor(private modelPath: string) {}

  async start(onDetected: () => void): Promise<void> {
    this.vosk = new Vosk();
    await this.vosk.loadModel(this.modelPath);

    const handleResult = (result: string) => {
      try {
        const text: string = (JSON.parse(result).text ?? '').toLowerCase().trim();
        if (text === 'hey toka') {
          onDetected();
        }
      } catch { /* ignore malformed JSON */ }
    };

    this.resultListener = this.vosk.onResult(handleResult);
    this.finalResultListener = this.vosk.onFinalResult(handleResult);

    await this.vosk.start({ grammar: HEY_TOKA_GRAMMAR });
  }

  async stop(): Promise<void> {
    this.vosk?.stop();
    this.resultListener?.remove();
    this.finalResultListener?.remove();
    this.vosk = null;
    this.resultListener = null;
    this.finalResultListener = null;
  }
}
