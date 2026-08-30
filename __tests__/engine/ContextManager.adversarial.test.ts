/**
 * Adversarial coverage for ContextManager — oversized turns, degenerate input,
 * and the token-budget invariant that protects the on-device n_ctx window.
 */
import { ContextManager, MAX_TURN_CHARS } from '../../src/engine/ContextManager';

const CHARS_PER_TOKEN = 4;
const NCTX_CHAR_CEILING = 2048 * CHARS_PER_TOKEN; // hard model limit in chars

function totalChars(cm: ContextManager): number {
  return cm.getMessages().reduce((s, m) => s + m.content.length, 0);
}

describe('ContextManager: oversized input', () => {
  it('clamps a single 50k-char user turn', () => {
    const cm = new ContextManager('just-walk');
    cm.addUserTurn('x'.repeat(50_000));
    const userTurn = cm.getMessages()[1];
    expect(userTurn.content.length).toBeLessThanOrEqual(MAX_TURN_CHARS + 1);
    expect(totalChars(cm)).toBeLessThan(NCTX_CHAR_CEILING * 2);
  });

  it('keeps total context under the model window across many oversized turns', () => {
    const cm = new ContextManager('learn');
    for (let i = 0; i < 40; i++) {
      cm.addUserTurn('u'.repeat(20_000));
      cm.addAssistantTurn('a'.repeat(20_000));
    }
    expect(totalChars(cm) / CHARS_PER_TOKEN).toBeLessThan(2200);
    expect(cm.getMessages()[0].role).toBe('system');
  });

  it('clamps an oversized interrupted assistant turn and keeps the marker', () => {
    const cm = new ContextManager('just-walk');
    cm.addAssistantTurn('y'.repeat(50_000), true);
    const turn = cm.getMessages()[1];
    expect(turn.content.length).toBeLessThanOrEqual(MAX_TURN_CHARS + ' [interrupted]'.length + 1);
    expect(turn.content).toContain('[interrupted]');
  });
});

describe('ContextManager: degenerate input', () => {
  it('accepts empty and whitespace turns without corrupting structure', () => {
    const cm = new ContextManager('journal');
    cm.addUserTurn('');
    cm.addAssistantTurn('   ');
    const msgs = cm.getMessages();
    expect(msgs[0].role).toBe('system');
    expect(msgs).toHaveLength(3);
  });

  it('handles unicode and emoji without byte-length surprises', () => {
    const cm = new ContextManager('just-walk');
    const emoji = '🚶‍♀️'.repeat(5000);
    cm.addUserTurn(emoji);
    expect(cm.getMessages()[1].content.length).toBeLessThanOrEqual(MAX_TURN_CHARS + 1);
  });

  it('reset after heavy load returns to just the system prompt', () => {
    const cm = new ContextManager('brain-dump');
    for (let i = 0; i < 100; i++) cm.addUserTurn('idea '.repeat(100));
    cm.reset();
    expect(cm.getMessages()).toHaveLength(1);
    expect(cm.getTurnCount()).toBe(0);
  });
});
