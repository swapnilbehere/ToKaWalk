const mockContext = {
  completion: jest.fn(() => Promise.resolve({ text: '' })),
  release: jest.fn(() => Promise.resolve()),
};

export const initLlama = jest.fn(() => Promise.resolve(mockContext));

export class LlamaContext {
  completion = jest.fn(() => Promise.resolve({ text: '' }));
  release = jest.fn(() => Promise.resolve());
}
