import Tts from 'react-native-tts';

// Exported for testing
export function splitIntoSentences(text: string): string[] {
  if (!text.trim()) return [];
  // Only split after punctuation that follows a lowercase letter.
  // This prevents splitting on abbreviations like U.S. or Dr. where
  // the letter before the period is uppercase.
  const parts = text.split(/(?<=[a-z][.!?])\s+/);
  return parts.map(s => s.trim()).filter(Boolean);
}

const MIN_FLUSH_TOKENS = 8;

export class TTSService {
  private buffer = '';
  private tokenCount = 0;

  async init(rate: number): Promise<void> {
    await Tts.setDefaultRate(rate);
  }

  feedToken(token: string): void {
    this.buffer += token;
    this.tokenCount++;

    const sentences = splitIntoSentences(this.buffer);
    if (sentences.length > 1 && this.tokenCount >= MIN_FLUSH_TOKENS) {
      const complete = sentences.slice(0, -1);
      this.buffer = sentences[sentences.length - 1];
      this.tokenCount = 0;
      complete.forEach(s => Tts.speak(s));
    }
  }

  flush(): void {
    if (this.buffer.trim()) {
      Tts.speak(this.buffer.trim());
      this.buffer = '';
      this.tokenCount = 0;
    }
  }

  stop(): void {
    Tts.stop();
    this.buffer = '';
    this.tokenCount = 0;
  }
}
