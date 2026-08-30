import { exists, stat, unlink, downloadFile } from 'react-native-fs';
import { checkLLMReady, downloadLLM } from '../../src/services/ModelManager';

const mockExists = exists as jest.Mock;
const mockStat = stat as jest.Mock;
const mockUnlink = unlink as jest.Mock;
const mockDownloadFile = downloadFile as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockExists.mockResolvedValue(true);
  mockStat.mockResolvedValue({ size: 1_200_000_000, isFile: () => true });
  mockUnlink.mockResolvedValue(undefined);
});

describe('checkLLMReady', () => {
  it('is false when the file does not exist', async () => {
    mockExists.mockResolvedValue(false);
    expect(await checkLLMReady()).toBe(false);
  });

  it('is true when a full-size model is present', async () => {
    expect(await checkLLMReady()).toBe(true);
  });

  it('is false AND deletes the file when it is a truncated stub', async () => {
    mockStat.mockResolvedValue({ size: 8_082_388, isFile: () => true }); // the real bug: an 8 MB partial download
    expect(await checkLLMReady()).toBe(false);
    expect(mockUnlink).toHaveBeenCalled();
  });

  it('is false when stat throws', async () => {
    mockStat.mockRejectedValue(new Error('EACCES'));
    expect(await checkLLMReady()).toBe(false);
  });

  it('treats a zero-byte file as not ready', async () => {
    mockStat.mockResolvedValue({ size: 0, isFile: () => true });
    expect(await checkLLMReady()).toBe(false);
  });
});

describe('downloadLLM', () => {
  it('reports a finite fraction even when contentLength is 0 or negative', async () => {
    const seen: number[] = [];
    mockDownloadFile.mockImplementation(({ progress }: any) => {
      progress({ bytesWritten: 1024, contentLength: 0 });
      progress({ bytesWritten: 2048, contentLength: -1 });
      return { promise: Promise.resolve({ statusCode: 200 }) };
    });
    await downloadLLM((p) => seen.push(p.fraction));
    expect(seen).toEqual([0, 0]);
    expect(seen.every(Number.isFinite)).toBe(true);
  });

  it('clamps fraction to at most 1', async () => {
    let frac = -1;
    mockDownloadFile.mockImplementation(({ progress }: any) => {
      progress({ bytesWritten: 999, contentLength: 100 });
      return { promise: Promise.resolve({ statusCode: 200 }) };
    });
    await downloadLLM((p) => { frac = p.fraction; });
    expect(frac).toBe(1);
  });

  it('throws on a non-200 response', async () => {
    mockDownloadFile.mockReturnValue({ promise: Promise.resolve({ statusCode: 416 }) });
    await expect(downloadLLM(() => {})).rejects.toThrow('HTTP 416');
  });
});
