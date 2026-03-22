import { GroqLLMService } from '../../src/services/llm/GroqLLMService';

global.fetch = jest.fn();

describe('GroqLLMService', () => {
  beforeEach(() => jest.clearAllMocks());

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
    const mockBody = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n',
      'data: {"choices":[{"delta":{"content":" world"}}]}\n',
      'data: [DONE]\n',
    ].join('');

    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      body: {
        getReader: () => {
          const enc = new TextEncoder();
          let done = false;
          return {
            read: async () => {
              if (done) return { done: true, value: undefined };
              done = true;
              return { done: false, value: enc.encode(mockBody) };
            },
          };
        },
      },
    });

    const service = new GroqLLMService('gsk_test');
    const tokens: string[] = [];
    for await (const t of service.generate([{ role: 'user', content: 'hi' }])) {
      tokens.push(t);
    }
    expect(tokens).toEqual(['Hello', ' world']);
  });

  it('throws on non-ok response', async () => {
    (fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 429 });
    const service = new GroqLLMService('gsk_test');
    const gen = service.generate([{ role: 'user', content: 'hi' }]);
    await expect(gen.next()).rejects.toThrow('Groq error: 429');
  });
});
