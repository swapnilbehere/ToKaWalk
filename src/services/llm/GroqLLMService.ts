import EventSource from 'react-native-sse';
import { LLMService } from './LLMService';
import { LLMMessage } from '../../types';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.1-8b-instant';

export class GroqLLMService implements LLMService {
  constructor(private apiKey: string) {}

  setApiKey(key: string): void {
    this.apiKey = key;
  }

  isReady(): boolean {
    return this.apiKey.trim().length > 0;
  }

  async *generate(messages: LLMMessage[]): AsyncGenerator<string> {
    if (!this.isReady()) throw new Error('Groq API key not set');

    console.log('[Groq] Starting request', {
      model: MODEL,
      messageCount: messages.length,
      lastRole: messages[messages.length - 1]?.role ?? null,
      lastContentPreview: messages[messages.length - 1]?.content?.slice(0, 80) ?? '',
    });

    const tokenQueue: string[] = [];
    let wakeConsumer: (() => void) | null = null;
    let streamError: Error | null = null;
    let done = false;
    let tokenCount = 0;

    const finish = (error?: Error) => {
      if (done) return;
      if (error) streamError = error;
      done = true;
      if (wakeConsumer) {
        wakeConsumer();
        wakeConsumer = null;
      }
    };

    const eventSource = new EventSource(GROQ_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: MODEL, messages, stream: true }),
      pollingInterval: 0,
      timeout: 30000,
    });

    eventSource.addEventListener('open', () => {
      console.log('[Groq] SSE connection opened');
    });

    eventSource.addEventListener('message', (event) => {
      const data = event.data?.trim();
      if (!data) return;
      if (data === '[DONE]') {
        console.log('[Groq] Stream completed', { tokenCount });
        finish();
        return;
      }

      try {
        const parsed = JSON.parse(data);
        const token = parsed.choices?.[0]?.delta?.content;
        if (token) {
          tokenCount += 1;
          tokenQueue.push(token);
          if (wakeConsumer) {
            wakeConsumer();
            wakeConsumer = null;
          }
        }
      } catch (error) {
        console.warn('[Groq] Skipping malformed stream line', {
          error,
          linePreview: data.slice(0, 120),
        });
      }
    });

    eventSource.addEventListener('error', (event) => {
      const status = (event as any).status ?? (event as any).xhrStatus;
      const base = 'message' in event && event.message ? event.message : 'Groq SSE error';
      const message = status ? `${base} (status ${status})` : base;
      console.error('[Groq] SSE error', { status, event });
      finish(new Error(message));
    });

    eventSource.addEventListener('close', () => {
      console.log('[Groq] SSE connection closed', { tokenCount, done });
      finish();
    });

    try {
      while (!done || tokenQueue.length > 0) {
        if (tokenQueue.length === 0) {
          await new Promise<void>((resolve) => {
            wakeConsumer = resolve;
          });
          continue;
        }

        yield tokenQueue.shift()!;
      }
    } finally {
      eventSource.removeAllEventListeners();
      eventSource.close();
    }

    if (streamError) {
      throw streamError;
    }
  }
}
