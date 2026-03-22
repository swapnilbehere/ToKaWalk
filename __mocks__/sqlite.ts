export default { openDatabase: jest.fn(() => ({ transaction: jest.fn(), executeSql: jest.fn() })) };
