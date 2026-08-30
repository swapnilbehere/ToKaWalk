import { LLMMessage, SessionMode } from '../types';
import { MODE_SYSTEM_PROMPTS } from '../constants/modes';

const MAX_TOKENS = 2000;
const CHARS_PER_TOKEN = 4;
const MAX_TURNS = 10; // max messages (user+assistant combined) kept in context

// Hard cap on a single turn's stored content (~400 tokens). The local model runs
// at n_ctx 2048; without this, one very long message (or a runaway generation)
// can push the whole context past the window even after turn-count pruning,
// which cannot drop below two turns.
export const MAX_TURN_CHARS = 1600;

function clampTurn(text: string): string {
  if (text.length <= MAX_TURN_CHARS) return text;
  // Trim back to a word boundary so we don't cut mid-token.
  const head = text.slice(0, MAX_TURN_CHARS);
  const lastSpace = head.lastIndexOf(' ');
  return `${(lastSpace > MAX_TURN_CHARS - 200 ? head.slice(0, lastSpace) : head).trimEnd()}…`;
}

export class ContextManager {
  private turns: LLMMessage[] = [];
  private systemPrompt: string;

  constructor(mode: SessionMode) {
    this.systemPrompt = MODE_SYSTEM_PROMPTS[mode];
  }

  addUserTurn(text: string): void {
    this.turns.push({ role: 'user', content: clampTurn(text) });
    this.pruneIfNeeded();
  }

  addAssistantTurn(text: string, interrupted = false): void {
    const clamped = clampTurn(text);
    const content = interrupted ? `${clamped} [interrupted]` : clamped;
    this.turns.push({ role: 'assistant', content });
    this.pruneIfNeeded();
  }

  getTurnCount(): number {
    return this.turns.length;
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
    // Enforce max turn count first (keeps most recent exchanges)
    while (this.turns.length > MAX_TURNS) {
      this.turns.shift();
    }
    // Then enforce token budget
    while (this.estimateTokens() > MAX_TOKENS && this.turns.length > 2) {
      this.turns.shift();
    }
  }
}
