const mockListener = { remove: jest.fn() };

export default class Vosk {
  loadModel = jest.fn(() => Promise.resolve());
  start = jest.fn(() => Promise.resolve());
  stop = jest.fn();
  unload = jest.fn();
  onResult = jest.fn(() => mockListener);
  onFinalResult = jest.fn(() => mockListener);
  onError = jest.fn(() => mockListener);
}
