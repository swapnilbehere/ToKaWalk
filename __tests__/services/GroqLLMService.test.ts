import EventSource from 'react-native-sse';
import { GroqLLMService } from '../../src/services/llm/GroqLLMService';

function getLastEventSource(): any {
  return (EventSource as any).instances[(EventSource as any).instances.length - 1];
}

describe('GroqLLMService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (EventSource as any).reset();
  });

  it('throws if API key is empty', async () => {
    const service = new GroqLLMService('');
    const gen = service.generate([{ role: 'user', content: 'hello' }]);
    await expect(gen.next()).rejects.toThrow('Groq API key not set');
  });

  it('isReady returns false for empty key', () => {
    expect(new GroqLLMService('').isReady()).toBe(false);
  });

  it('isReady returns true for non-empty key', () => {
    expect(new GroqLLMService('gsk_test').isReady()).toBe(true);
  });

  it('yields streamed tokens from Groq response', async () => {
    const service = new GroqLLMService('gsk_test');
    const gen = service.generate([{ role: 'user', content: 'hi' }]);
    const firstToken = gen.next();
    const source = getLastEventSource();

    source.emit('open', {});
    source.emit('message', { data: '{"choices":[{"delta":{"content":"Hello"}}]}' });
    await expect(firstToken).resolves.toEqual({ value: 'Hello', done: false });

    const secondToken = gen.next();
    source.emit('message', { data: '{"choices":[{"delta":{"content":" world"}}]}' });
    await expect(secondToken).resolves.toEqual({ value: ' world', done: false });

    const done = gen.next();
    source.emit('message', { data: '[DONE]' });
    await expect(done).resolves.toEqual({ value: undefined, done: true });
    expect(source.closed).toBe(true);
  });

  it('throws on SSE error', async () => {
    const service = new GroqLLMService('gsk_test');
    const gen = service.generate([{ role: 'user', content: 'hi' }]);
    const firstToken = gen.next();
    const source = getLastEventSource();

    source.emit('error', { message: 'boom' });
    await expect(firstToken).rejects.toThrow('boom');
    expect(source.closed).toBe(true);
  });
});
