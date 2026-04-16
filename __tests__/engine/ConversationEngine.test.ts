import { ConversationEngine } from '../../src/engine/ConversationEngine';

// All services mocked
const mockSTT = { init: jest.fn(), startListening: jest.fn(), stopListening: jest.fn(), destroy: jest.fn() };
const mockTTS = { init: jest.fn(), feedToken: jest.fn(), flush: jest.fn(), stop: jest.fn() };
const mockLLM = {
  isReady: jest.fn(() => true),
  generate: jest.fn(async function* () { yield 'Hello'; yield ' world'; }),
};
const mockSessionRepo = { create: jest.fn(() => 1), end: jest.fn(), list: jest.fn(() => []) };
const mockTurnRepo = { add: jest.fn(), getForSession: jest.fn(() => []) };
const mockSummaryRepo = { save: jest.fn(), getForSession: jest.fn() };

describe('ConversationEngine', () => {
  it('starts in idle state', () => {
    const engine = new ConversationEngine({
      stt: mockSTT as any,
      tts: mockTTS as any,
      localLLM: mockLLM as any,
      onlineLLM: mockLLM as any,
      sessionRepo: mockSessionRepo as any,
      turnRepo: mockTurnRepo as any,
      summaryRepo: mockSummaryRepo as any,
    });
    expect(engine.state).toBe('idle');
  });

  it('detects "bye nova" phrase and triggers session end', () => {
    const engine = new ConversationEngine({
      stt: mockSTT as any,
      tts: mockTTS as any,
      localLLM: mockLLM as any,
      onlineLLM: mockLLM as any,
      sessionRepo: mockSessionRepo as any,
      turnRepo: mockTurnRepo as any,
      summaryRepo: mockSummaryRepo as any,
    });
    expect(engine.isByeNova('bye nova')).toBe(true);
    expect(engine.isByeNova('goodbye Nova')).toBe(true);
    expect(engine.isByeNova('all good thanks bye Nova')).toBe(true);
    expect(engine.isByeNova('buy nova')).toBe(true);
    expect(engine.isByeNova('by nova')).toBe(true);
    expect(engine.isByeNova('bye')).toBe(false);
    expect(engine.isByeNova('nova')).toBe(false);
    expect(engine.isByeNova('I said bye nova and then something else')).toBe(false);
  });
});
