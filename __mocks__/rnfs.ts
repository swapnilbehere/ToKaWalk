export const DocumentDirectoryPath = '/mock/documents';
export const ExternalDirectoryPath = '/mock/external';
export const exists = jest.fn(() => Promise.resolve(true));
export const downloadFile = jest.fn(() => ({ promise: Promise.resolve({ statusCode: 200 }) }));
export const stat = jest.fn(() =>
  Promise.resolve({ size: 1_200_000_000, isFile: () => true, isDirectory: () => false }),
);
export const unlink = jest.fn(() => Promise.resolve());
