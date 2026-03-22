import { ConversationEngine } from '../../src/engine/ConversationEngine';

// All services mocked
const mockWakeWord = { start: jest.fn(), stop: jest.fn() };
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
      wakeWord: mockWakeWord as any,
      stt: mockSTT as any,
      tts: mockTTS as any,
      llm: mockLLM as any,
      sessionRepo: mockSessionRepo as any,
      turnRepo: mockTurnRepo as any,
      summaryRepo: mockSummaryRepo as any,
    });
    expect(engine.state).toBe('idle');
  });

  it('detects "bye toka" phrase and triggers session end', () => {
    const engine = new ConversationEngine({
      wakeWord: mockWakeWord as any,
      stt: mockSTT as any,
      tts: mockTTS as any,
      llm: mockLLM as any,
      sessionRepo: mockSessionRepo as any,
      turnRepo: mockTurnRepo as any,
      summaryRepo: mockSummaryRepo as any,
    });
    expect(engine.isByeToka('bye toka')).toBe(true);
    expect(engine.isByeToka('goodbye Toka')).toBe(true);
    expect(engine.isByeToka('bye')).toBe(false);
    expect(engine.isByeToka('I said bye toka and then something else')).toBe(false);
  });
});
