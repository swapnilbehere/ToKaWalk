const emptyResult = { rows: [], insertId: undefined, rowsAffected: 0 };

const mockDb = {
  execute: jest.fn(() => Promise.resolve(emptyResult)),
  executeSync: jest.fn(() => emptyResult),
  close: jest.fn(() => Promise.resolve()),
};

export const open = jest.fn(() => mockDb);
export const IOS_DOCUMENT_PATH = '/tmp';
export const IOS_LIBRARY_PATH = '/tmp';
export const ANDROID_DATABASE_PATH = '/tmp';
export const ANDROID_FILES_PATH = '/tmp';
export const ANDROID_EXTERNAL_FILES_PATH = '/tmp';
