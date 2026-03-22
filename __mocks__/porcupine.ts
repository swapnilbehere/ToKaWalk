const mockManager = { start: jest.fn(() => Promise.resolve()), stop: jest.fn(() => Promise.resolve()), delete: jest.fn(() => Promise.resolve()) };
export const PorcupineManager = { create: jest.fn(() => Promise.resolve(mockManager)) };
