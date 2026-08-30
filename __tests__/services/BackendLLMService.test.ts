import EventSource from 'react-native-sse';
import { BackendLLMService } from '../../src/services/llm/BackendLLMService';

async function lastSource(): Promise<any> {
  // generate() awaits measureLatency() (a fetch) before constructing EventSource,
  // so give the microtask/macrotask queue a few ticks to get there.
  for (let i = 0; i < 20; i++) {
    const all = (EventSource as any).instances;
    if (all.length) return all[all.length - 1];
    await new Promise((r) => setTimeout(r, 0));
  }
  throw new Error('EventSource was never constructed');
}

beforeEach(() => {
  jest.clearAllMocks();
  (EventSource as any).reset();
  // measureLatency() calls fetch — stub it so tests never touch the network.
  (global as any).fetch = jest.fn(() => Promise.resolve({ ok: true }));
});

async function drain(gen: AsyncGenerator<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const t of gen) out.push(t);
  return out;
}

describe('BackendLLMService.generate — input validation', () => {
  it('rejects when there is no user message', async () => {
    const svc = new BackendLLMService();
    await expect(drain(svc.generate([]))).rejects.toThrow(/user/i);
  });

  it('rejects when the last message is not from the user', async () => {
    const svc = new BackendLLMService();
    const gen = svc.generate([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]);
    await expect(drain(gen)).rejects.toThrow(/user/i);
  });

  it('isReady is always true (stateless HTTP)', () => {
    expect(new BackendLLMService().isReady()).toBe(true);
  });
});

describe('BackendLLMService.generate — streaming', () => {
  it('yields tokens in order then completes on [DONE]', async () => {
    const svc = new BackendLLMService();
    const gen = svc.generate([{ role: 'user', content: 'hi' }]);
    const p = drain(gen);
    await Promise.resolve();
    const src = await lastSource();
    src.emit('message', { data: 'Hel' });
    src.emit('message', { data: 'lo' });
    src.emit('message', { data: ' there' });
    src.emit('message', { data: '[DONE]' });
    expect(await p).toEqual(['Hel', 'lo', ' there']);
  });

  it('ignores empty/whitespace SSE frames', async () => {
    const svc = new BackendLLMService();
    const gen = svc.generate([{ role: 'user', content: 'hi' }]);
    const p = drain(gen);
    await Promise.resolve();
    const src = await lastSource();
    src.emit('message', { data: '   ' });
    src.emit('message', { data: '' });
    src.emit('message', { data: 'real' });
    src.emit('message', { data: '[DONE]' });
    expect(await p).toEqual(['real']);
  });

  it('throws the backend message on an [ERROR] frame', async () => {
    const svc = new BackendLLMService();
    const gen = svc.generate([{ role: 'user', content: 'hi' }]);
    const p = drain(gen);
    await Promise.resolve();
    (await lastSource()).emit('message', { data: '[ERROR] rate limit exceeded' });
    await expect(p).rejects.toThrow('rate limit exceeded');
  });

  it('throws on a transport error event', async () => {
    const svc = new BackendLLMService();
    const gen = svc.generate([{ role: 'user', content: 'hi' }]);
    const p = drain(gen);
    await Promise.resolve();
    (await lastSource()).emit('error', { message: 'network down', status: 503 });
    await expect(p).rejects.toThrow(/network down|503/);
  });

  it('completes cleanly if the stream closes after some tokens', async () => {
    const svc = new BackendLLMService();
    const gen = svc.generate([{ role: 'user', content: 'hi' }]);
    const p = drain(gen);
    await Promise.resolve();
    const src = await lastSource();
    src.emit('message', { data: 'partial' });
    src.emit('close', {});
    expect(await p).toEqual(['partial']);
  });
});

describe('BackendLLMService — session id', () => {
  it('notifySessionStart rotates the id', () => {
    const svc = new BackendLLMService();
    const before = (svc as any).sessionId;
    svc.notifySessionStart();
    expect((svc as any).sessionId).not.toBe(before);
  });
});
