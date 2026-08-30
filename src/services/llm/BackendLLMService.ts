import EventSource from 'react-native-sse';
import { LLMService } from './LLMService';
import { LLMMessage } from '../../types';

// Backend host. Update this after deploying api/ (see render.yaml). Render's
// free plan cold-starts (~50s) after idle, so the first request post-idle may
// be slow or time out; a retry succeeds.
const BACKEND_URL = 'https://tokawalk-api.onrender.com';

function makeSessionId(): string {
  return `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Routes online LLM calls through the Railway backend instead of hitting Groq
 * directly. This enables centralised logging, QueryClassifier routing, and the
 * eval pipeline on production traffic from the mobile app.
 *
 * The backend adds its own Nova system prompt, so we strip the local one and
 * forward it via system_prompt so mode-specific personas are preserved.
 */
export class BackendLLMService implements LLMService {
  private sessionId = makeSessionId();

  /** Call when a new conversation session starts so turns are grouped correctly. */
  notifySessionStart(): void {
    this.sessionId = makeSessionId();
    console.log('[Backend] New session ID', this.sessionId);
  }

  isReady(): boolean {
    return true;
  }

  private async measureLatency(): Promise<number> {
    try {
      const start = Date.now();
      await fetch(`${BACKEND_URL}/health`, { method: 'HEAD' });
      return Date.now() - start;
    } catch {
      return 9999;
    }
  }

  async *generate(messages: LLMMessage[]): AsyncGenerator<string> {
    // Separate system prompt (forwarded to backend) from conversation turns.
    const systemMsg = messages.find(m => m.role === 'system');
    const turns = messages.filter(m => m.role !== 'system');
    const lastMsg = turns[turns.length - 1];

    if (!lastMsg || lastMsg.role !== 'user') {
      throw new Error('[Backend] Last message must be from user');
    }

    const history = turns.slice(0, -1).map(m => ({ role: m.role, content: m.content }));
    const message = lastMsg.content;
    const networkLatencyMs = await this.measureLatency();

    console.log('[Backend] Starting request', {
      sessionId: this.sessionId,
      messageCount: turns.length,
      networkLatencyMs,
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
      wakeConsumer?.();
      wakeConsumer = null;
    };

    const eventSource = new EventSource(`${BACKEND_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        session_id: this.sessionId,
        history,
        network_latency_ms: networkLatencyMs,
        system_prompt: systemMsg?.content ?? null,
      }),
      pollingInterval: 0,
      timeout: 30_000,
    });

    eventSource.addEventListener('open', () => {
      console.log('[Backend] SSE connection opened');
    });

    eventSource.addEventListener('message', event => {
      // Keep the raw payload — LLM tokens routinely carry a leading space
      // (" there", " world"); trimming here would collapse word boundaries.
      // Only the trimmed copy is used for sentinel/empty detection.
      const raw = (event.data ?? '').replace(/\r?\n$/, '');
      const data = raw.trim();
      if (!data) return;

      if (data.startsWith('[DONE]')) {
        console.log('[Backend] Stream complete', { tokenCount });
        finish();
        return;
      }

      if (data.startsWith('[ERROR]')) {
        finish(new Error(data.slice(7).trim()));
        return;
      }

      tokenCount += 1;
      tokenQueue.push(raw);
      if (wakeConsumer) {
        wakeConsumer();
        wakeConsumer = null;
      }
    });

    eventSource.addEventListener('error', event => {
      const status = (event as any).status ?? (event as any).xhrStatus;
      const base =
        'message' in event && (event as any).message
          ? (event as any).message
          : 'Backend SSE error';
      const msg = status ? `${base} (status ${status})` : base;
      console.error('[Backend] SSE error', { status });
      finish(new Error(msg));
    });

    eventSource.addEventListener('close', () => {
      console.log('[Backend] SSE connection closed', { tokenCount, done });
      finish();
    });

    try {
      while (!done || tokenQueue.length > 0) {
        if (tokenQueue.length === 0) {
          await new Promise<void>(resolve => {
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

    if (streamError) throw streamError;
  }
}
