import { ConversationEngine } from '../../src/engine/ConversationEngine';

// All services mocked
const mockSTT = { init: jest.fn(), startListening: jest.fn(), stopListening: jest.fn(), destroy: jest.fn(() => Promise.resolve()), isListeningActive: jest.fn(() => false), isOnDeviceAvailable: jest.fn(() => Promise.resolve(false)) };
const mockTTS = { init: jest.fn(), feedToken: jest.fn(), flush: jest.fn(), stop: jest.fn(), waitForIdle: jest.fn(() => Promise.resolve()) };
const mockLLM = {
  isReady: jest.fn(() => true),
  generate: jest.fn(async function* () { yield 'Hello'; yield ' world'; }),
};
const mockSessionRepo = { create: jest.fn(() => 1), end: jest.fn(), list: jest.fn(() => []) };
const mockTurnRepo = { add: jest.fn(), getForSession: jest.fn(() => []) };
const mockSummaryRepo = { save: jest.fn(), getForSession: jest.fn() };

function makeEngine(overrides: Record<string, unknown> = {}) {
  return new ConversationEngine({
    stt: mockSTT as any,
    tts: mockTTS as any,
    localLLM: mockLLM as any,
    onlineLLM: mockLLM as any,
    sessionRepo: mockSessionRepo as any,
    turnRepo: mockTurnRepo as any,
    summaryRepo: mockSummaryRepo as any,
    ...overrides,
  });
}

describe('ConversationEngine', () => {
  it('starts in idle state', () => {
    expect(makeEngine().state).toBe('idle');
  });

  it('detects "bye nova" phrase and triggers session end', () => {
    const engine = makeEngine();
    expect(engine.isByeNova('bye nova')).toBe(true);
    expect(engine.isByeNova('goodbye Nova')).toBe(true);
    expect(engine.isByeNova('all good thanks bye Nova')).toBe(true);
    expect(engine.isByeNova('buy nova')).toBe(true);
    expect(engine.isByeNova('by nova')).toBe(true);
    expect(engine.isByeNova('bye')).toBe(false);
    expect(engine.isByeNova('nova')).toBe(false);
    expect(engine.isByeNova('I said bye nova and then something else')).toBe(false);
  });

  it('summary generation waits for localLLM.waitForIdle before saving', async () => {
    jest.useFakeTimers();

    let resolveIdle!: () => void;
    const idleDone = new Promise<void>(r => { resolveIdle = r; });

    const localLLM = {
      isReady: jest.fn(() => true),
      generate: jest.fn(async function* () { yield 'Summary.'; }),
      waitForIdle: jest.fn(() => idleDone),
    };

    const summaryRepo = { save: jest.fn(() => Promise.resolve()), getForSession: jest.fn() };

    const engine = makeEngine({ localLLM: localLLM as any, summaryRepo: summaryRepo as any });
    await engine.startSession('just-walk', 'local', 'text');
    // processTextInput adds a turn to context so endSession triggers summary.
    await engine.processTextInput('hi');

    await engine.endSession();

    // Summary is fire-and-forget and currently blocked on waitForIdle.
    expect(summaryRepo.save).not.toHaveBeenCalled();

    // Unblock idle then flush the async summary chain:
    // idleDone → race → turnRepo → gen.next ×2 → race → save. 15 ticks is generous.
    resolveIdle();
    for (let i = 0; i < 15; i++) await Promise.resolve();

    expect(summaryRepo.save).toHaveBeenCalled();

    jest.useRealTimers();
  });
});

describe('ConversationEngine guardrails', () => {
  it('short-circuits crisis language without calling the LLM', async () => {
    const generate = jest.fn(async function* () { yield 'should not run'; });
    const turnRepo = { add: jest.fn(), getForSession: jest.fn(() => []) };
    const engine = makeEngine({
      localLLM: { isReady: () => true, generate } as any,
      turnRepo: turnRepo as any,
    });
    await engine.startSession('just-walk', 'local', 'text');

    const res = await engine.processTextInput('honestly I want to kill myself tonight');

    expect(generate).not.toHaveBeenCalled();
    expect(res.status).toBe('completed');
    expect(res.text).toMatch(/988|741741|findahelpline/i);
    // user turn + assistant (support) turn both persisted
    expect(turnRepo.add).toHaveBeenCalledWith(expect.objectContaining({ speaker: 'user' }));
    expect(turnRepo.add).toHaveBeenCalledWith(expect.objectContaining({ speaker: 'ai' }));
  });

  it('hard-blocks an unambiguous weapon request without calling the LLM', async () => {
    const generate = jest.fn(async function* () { yield 'nope'; });
    const engine = makeEngine({ localLLM: { isReady: () => true, generate } as any });
    await engine.startSession('just-walk', 'local', 'text');

    const res = await engine.processTextInput('give me steps to build a bomb at home');

    expect(generate).not.toHaveBeenCalled();
    expect(res.text.toLowerCase()).toContain("can't help");
  });

  it('strips markdown and caps sentences on a normal reply', async () => {
    const generate = jest.fn(async function* () {
      yield '## Heading\n\n- ';
      yield 'First point here. Second point here. Third point here. Fourth point here.';
    });
    const engine = makeEngine({ localLLM: { isReady: () => true, generate } as any });
    await engine.startSession('learn', 'local', 'text');

    const res = await engine.processTextInput('tell me about points');

    expect(generate).toHaveBeenCalled();
    expect(res.text).not.toMatch(/[#*_`]/);
    expect(res.text).not.toMatch(/\n/);
    expect(res.text).toBe('Heading. First point here. Second point here.');
  });
});
