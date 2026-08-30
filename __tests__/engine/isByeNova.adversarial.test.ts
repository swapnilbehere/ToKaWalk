/**
 * "Bye Nova" ends the session. A false positive silently drops the user
 * mid-conversation, so the matcher must be strict about the word "nova".
 */
import { ConversationEngine } from '../../src/engine/ConversationEngine';

const noop = () => {};
function makeEngine() {
  return new ConversationEngine({
    stt: { init: noop, startListening: noop, stopListening: noop, destroy: () => Promise.resolve(), isListeningActive: () => false, isOnDeviceAvailable: () => Promise.resolve(false) } as any,
    tts: { init: noop, feedToken: noop, flush: noop, stop: noop, waitForIdle: () => Promise.resolve() } as any,
    localLLM: { isReady: () => true, generate: async function* () { yield 'x'; } } as any,
    onlineLLM: { isReady: () => true, generate: async function* () { yield 'x'; } } as any,
    sessionRepo: { create: () => 1, end: noop, list: () => [] } as any,
    turnRepo: { add: noop, getForSession: () => [] } as any,
    summaryRepo: { save: noop, getForSession: noop } as any,
  });
}

describe('isByeNova — true positives', () => {
  const e = makeEngine();
  it.each([
    'bye nova',
    'Bye Nova',
    'goodbye Nova',
    'by nova', // common STT mishear
    'buy nova',
    'ok bye nova',
    'alright thanks bye nova',
    'Bye, Nova.',
    'bye nova!',
  ])('matches %p', (phrase) => {
    expect(e.isByeNova(phrase)).toBe(true);
  });
});

describe('isByeNova — false positives that must NOT end the session', () => {
  const e = makeEngine();
  it.each([
    'bye that was so innovative',
    'buy paint to renovate the kitchen',
    'the supernova documentary was amazing',
    'goodbye feels premature, I have more to say',
    'nova is a nice name for a dog',
    'by the way I saw a nova scotia licence plate',
    'Casanova is on my watchlist',
    'I said bye nova and then something else entirely happened next',
    'bye',
    'nova',
  ])('does not match %p', (phrase) => {
    expect(e.isByeNova(phrase)).toBe(false);
  });
});
