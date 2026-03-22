import { LLMMessage, SessionMode } from '../types';
import { MODE_SYSTEM_PROMPTS } from '../constants/modes';

const MAX_TOKENS = 3800;
const CHARS_PER_TOKEN = 4;

export class ContextManager {
  private turns: LLMMessage[] = [];
  private systemPrompt: string;

  constructor(mode: SessionMode) {
    this.systemPrompt = MODE_SYSTEM_PROMPTS[mode];
  }

  addUserTurn(text: string): void {
    this.turns.push({ role: 'user', content: text });
    this.pruneIfNeeded();
  }

  addAssistantTurn(text: string, interrupted = false): void {
    const content = interrupted ? `${text} [interrupted]` : text;
    this.turns.push({ role: 'assistant', content });
    this.pruneIfNeeded();
  }

  getMessages(): LLMMessage[] {
    return [{ role: 'system', content: this.systemPrompt }, ...this.turns];
  }

  reset(): void {
    this.turns = [];
  }

  private estimateTokens(): number {
    return this.getMessages().reduce((sum, m) => sum + m.content.length, 0) / CHARS_PER_TOKEN;
  }

  private pruneIfNeeded(): void {
    while (this.estimateTokens() > MAX_TOKENS && this.turns.length > 2) {
      this.turns.shift();
    }
  }
}
