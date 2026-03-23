const mockListener = { remove: jest.fn() };

export default {
  loadModel: jest.fn(() => Promise.resolve()),
  start: jest.fn(() => Promise.resolve()),
  stop: jest.fn(() => Promise.resolve()),
  onResult: jest.fn(() => mockListener),
  onFinalResult: jest.fn(() => mockListener),
};
