export const DocumentDirectoryPath = '/mock/documents';
export const ExternalDirectoryPath = '/mock/external';
export const exists = jest.fn(() => Promise.resolve(true));
export const downloadFile = jest.fn(() => ({ promise: Promise.resolve({ statusCode: 200 }) }));
