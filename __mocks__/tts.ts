export default {
  speak: jest.fn(),
  stop: jest.fn(),
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
  setDefaultRate: jest.fn(() => Promise.resolve()),
  setDefaultLanguage: jest.fn(() => Promise.resolve()),
};
