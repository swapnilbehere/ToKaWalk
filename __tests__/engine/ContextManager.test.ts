import { ContextManager } from '../../src/engine/ContextManager';
import { MODE_SYSTEM_PROMPTS } from '../../src/constants/modes';

describe('ContextManager', () => {
  it('starts with only the system prompt', () => {
    const cm = new ContextManager('just-walk');
    const messages = cm.getMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toBe(MODE_SYSTEM_PROMPTS['just-walk']);
  });

  it('adds user and assistant turns', () => {
    const cm = new ContextManager('just-walk');
    cm.addUserTurn('hello');
    cm.addAssistantTurn('hi there');
    const messages = cm.getMessages();
    expect(messages).toHaveLength(3);
    expect(messages[1]).toEqual({ role: 'user', content: 'hello' });
    expect(messages[2]).toEqual({ role: 'assistant', content: 'hi there' });
  });

  it('marks interrupted turns in context', () => {
    const cm = new ContextManager('just-walk');
    cm.addAssistantTurn('partial response', true);
    const messages = cm.getMessages();
    expect(messages[1].content).toContain('[interrupted]');
  });

  it('system prompt is never pruned', () => {
    const cm = new ContextManager('just-walk');
    for (let i = 0; i < 200; i++) {
      cm.addUserTurn('x'.repeat(100));
      cm.addAssistantTurn('y'.repeat(100));
    }
    const messages = cm.getMessages();
    expect(messages[0].role).toBe('system');
  });

  it('prunes oldest turns when approaching token limit', () => {
    const cm = new ContextManager('just-walk');
    for (let i = 0; i < 200; i++) {
      cm.addUserTurn('x'.repeat(100));
      cm.addAssistantTurn('y'.repeat(100));
    }
    const messages = cm.getMessages();
    const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
    const estimatedTokens = totalChars / 4;
    expect(estimatedTokens).toBeLessThan(3800);
  });

  it('reset clears all turns but keeps system prompt', () => {
    const cm = new ContextManager('brain-dump');
    cm.addUserTurn('idea');
    cm.reset();
    expect(cm.getMessages()).toHaveLength(1);
    expect(cm.getMessages()[0].role).toBe('system');
  });
});
