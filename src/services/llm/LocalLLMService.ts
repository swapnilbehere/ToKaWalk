import { LlamaContext } from 'llama.rn';
import { LLMService } from './LLMService';
import { LLMMessage } from '../../types';

export class LocalLLMService implements LLMService {
  private context: any = null;

  async load(modelPath: string): Promise<void> {
    this.context = await LlamaContext.create({ model: modelPath, n_ctx: 4096 });
  }

  isReady(): boolean {
    return this.context !== null;
  }

  async *generate(messages: LLMMessage[]): AsyncGenerator<string> {
    if (!this.context) throw new Error('Local model not loaded');

    const tokens: string[] = [];
    let finished = false;
    let resolve: (() => void) | null = null;

    this.context.completion(
      { messages },
      (token: string) => {
        tokens.push(token);
        resolve?.();
      },
    ).then(() => {
      finished = true;
      resolve?.();
    });

    while (!finished || tokens.length > 0) {
      if (tokens.length === 0) {
        await new Promise<void>(r => { resolve = r; });
      }
      while (tokens.length > 0) {
        yield tokens.shift()!;
      }
    }
  }
}
