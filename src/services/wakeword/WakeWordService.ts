import { PorcupineManager } from '@picovoice/porcupine-react-native';

// Obtain your AccessKey from https://console.picovoice.ai/
// The "Hey Toka" keyword file (.ppn) is trained via Picovoice Console and
// bundled under android/app/src/main/assets/ and ios/ToKaWalk/
const ACCESS_KEY = process.env.PORCUPINE_ACCESS_KEY ?? 'YOUR_PORCUPINE_ACCESS_KEY';
const HEY_TOKA_KEYWORD_PATH = 'hey_toka.ppn'; // bundled asset

export class WakeWordService {
  private manager: any = null;

  async start(onDetected: () => void): Promise<void> {
    this.manager = await PorcupineManager.create(
      ACCESS_KEY,
      [{ builtin: null, label: 'hey-toka', path: HEY_TOKA_KEYWORD_PATH }],
      (index: number) => { if (index === 0) onDetected(); },
    );
    await this.manager.start();
  }

  async stop(): Promise<void> {
    await this.manager?.stop();
    await this.manager?.delete();
    this.manager = null;
  }
}
