import { initLlama, LlamaContext, TokenData, RNLlamaOAICompatibleMessage } from 'llama.rn';
import { LLMService } from './LLMService';
import { LLMMessage } from '../../types';

export class LocalLLMService implements LLMService {
  private context: LlamaContext | null = null;
  private loadPromise: Promise<void> | null = null;

  constructor(private modelPath: string) {}

  async load(modelPath = this.modelPath): Promise<void> {
    if (this.context) return;
    if (!this.loadPromise) {
      this.loadPromise = (async () => {
        this.context = await initLlama({ model: modelPath, n_ctx: 2048, n_threads: 2 });
      })().finally(() => {
        this.loadPromise = null;
      });
    }
    await this.loadPromise;
  }

  isReady(): boolean {
    return this.context !== null;
  }

  async *generate(messages: LLMMessage[]): AsyncGenerator<string> {
    if (!this.context) {
      await this.load();
    }
    if (!this.context) throw new Error('Local model not loaded');

    console.log('[LocalLLM] Starting completion', {
      messageCount: messages.length,
      lastRole: messages[messages.length - 1]?.role ?? null,
      lastContentPreview: messages[messages.length - 1]?.content?.slice(0, 80) ?? '',
    });

    const tokens: string[] = [];
    let finished = false;
    let completionError: unknown = null;
    let resolve: (() => void) | null = null;

    const rnMessages: RNLlamaOAICompatibleMessage[] = messages.map(m => ({
      role: m.role,
      content: m.content,
    }));

    this.context.completion(
      {
        messages: rnMessages,
        stop: ['<|im_end|>', '<|endoftext|>', '<|im_start|>'],
        n_predict: 256,
        temperature: 0.7,
        repeat_penalty: 1.1,
      },
      (data: TokenData) => {
        tokens.push(data.token);
        resolve?.();
      },
    ).then(() => {
      finished = true;
      resolve?.();
    }).catch((err: unknown) => {
      completionError = err;
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

    if (completionError !== null) {
      throw completionError instanceof Error
        ? completionError
        : new Error(String(completionError));
    }
  }
}
