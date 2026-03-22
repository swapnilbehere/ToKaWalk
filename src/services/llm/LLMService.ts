import { LLMMessage } from '../../types';

export interface LLMService {
  generate(messages: LLMMessage[]): AsyncGenerator<string>;
  isReady(): boolean;
}
