const emptyResult = { rows: { length: 0, item: jest.fn() } };
const mockDb = {
  transaction: jest.fn(),
  executeSql: jest.fn(() => Promise.resolve([emptyResult])),
};
export default {
  enablePromise: jest.fn(),
  openDatabase: jest.fn(() => Promise.resolve(mockDb)),
};
