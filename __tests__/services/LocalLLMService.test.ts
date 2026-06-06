import { LocalLLMService } from '../../src/services/llm/LocalLLMService';
import { initLlama } from 'llama.rn';

jest.mock('llama.rn');

const mockInitLlama = initLlama as jest.Mock;

function makeControllableContext() {
  let resolveCompletion!: () => void;
  let rejectCompletion!: (e: Error) => void;

  const context = {
    completion: jest.fn((_params: unknown, _cb: unknown) =>
      new Promise<void>((res, rej) => {
        resolveCompletion = res;
        rejectCompletion = rej;
      }),
    ),
    release: jest.fn(),
  };

  return { context, resolveCompletion: () => resolveCompletion(), rejectCompletion: (e: Error) => rejectCompletion(e) };
}

async function drainGenerator(gen: AsyncGenerator<string>) {
  const tokens: string[] = [];
  try {
    for await (const t of gen) tokens.push(t);
  } catch { /* error path tested separately */ }
  return tokens;
}

describe('LocalLLMService.waitForIdle', () => {
  it('resolves immediately when no generation is in progress', async () => {
    mockInitLlama.mockResolvedValue(makeControllableContext().context);
    const svc = new LocalLLMService('/fake/model.gguf');
    await expect(svc.waitForIdle()).resolves.toBeUndefined();
  });

  it('is pending while a generation is running, then resolves when it finishes', async () => {
    const { context, resolveCompletion } = makeControllableContext();
    mockInitLlama.mockResolvedValue(context);

    const svc = new LocalLLMService('/fake/model.gguf');
    await svc.load();

    const genDone = drainGenerator(svc.generate([{ role: 'user', content: 'hi' }]));

    // Flush enough microtasks for the generator to start and block on completion.
    await Promise.resolve();
    await Promise.resolve();

    let idleResolved = false;
    const idlePromise = svc.waitForIdle().then(() => { idleResolved = true; });

    await Promise.resolve();
    expect(idleResolved).toBe(false);

    resolveCompletion();
    await genDone;
    await idlePromise;

    expect(idleResolved).toBe(true);
  });

  it('resolves even when generation throws', async () => {
    const { context, rejectCompletion } = makeControllableContext();
    mockInitLlama.mockResolvedValue(context);

    const svc = new LocalLLMService('/fake/model.gguf');
    await svc.load();

    const genDone = drainGenerator(svc.generate([{ role: 'user', content: 'hi' }]));

    await Promise.resolve();
    await Promise.resolve();

    rejectCompletion(new Error('model crash'));
    await genDone;

    await expect(svc.waitForIdle()).resolves.toBeUndefined();
  });
});
