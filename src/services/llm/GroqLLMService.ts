import { LLMService } from './LLMService';
import { LLMMessage } from '../../types';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.1-8b-instant';

export class GroqLLMService implements LLMService {
  constructor(private apiKey: string) {}

  isReady(): boolean {
    return this.apiKey.trim().length > 0;
  }

  async *generate(messages: LLMMessage[]): AsyncGenerator<string> {
    if (!this.isReady()) throw new Error('Groq API key not set');

    const response = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: MODEL, messages, stream: true }),
    });

    if (!response.ok) {
      throw new Error(`Groq error: ${response.status}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = response as any;
    const reader = r.body.getReader();
    const decoder = new (globalThis as any).TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') return;
        try {
          const parsed = JSON.parse(data);
          const token = parsed.choices?.[0]?.delta?.content;
          if (token) yield token;
        } catch { /* skip malformed lines */ }
      }
    }
  }
}
