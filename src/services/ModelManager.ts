import { Platform } from 'react-native';
import {
  DocumentDirectoryPath,
  ExternalDirectoryPath,
  exists,
  downloadFile,
  unlink,
} from 'react-native-fs';
import { unzip } from 'react-native-zip-archive';

const DOCS_DIR =
  Platform.OS === 'ios' ? DocumentDirectoryPath : ExternalDirectoryPath;

export const VOSK_MODEL_DIR = `${DOCS_DIR}/vosk-model-small-en-us-0.15`;
export const LLM_MODEL_PATH = `${DOCS_DIR}/qwen2.5-1.5b-instruct-q4_k_m.gguf`;

const VOSK_ZIP_URL =
  'https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip';

// Qwen2.5-1.5B-Instruct Q4_K_M (~900 MB) — fits comfortably in 2 GB free RAM
const LLM_URL =
  'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf';

export type ModelKey = 'vosk' | 'llm';

export interface DownloadProgress {
  model: ModelKey;
  /** 0–1 */
  fraction: number;
  bytesWritten: number;
  totalBytes: number;
}

export async function checkModelsReady(): Promise<{ vosk: boolean; llm: boolean }> {
  const [vosk, llm] = await Promise.all([
    exists(VOSK_MODEL_DIR),
    exists(LLM_MODEL_PATH),
  ]);
  return { vosk, llm };
}

export async function downloadVosk(
  onProgress: (p: DownloadProgress) => void,
): Promise<void> {
  const zipPath = `${DOCS_DIR}/vosk-tmp.zip`;

  const dl = downloadFile({
    fromUrl: VOSK_ZIP_URL,
    toFile: zipPath,
    progressDivider: 1,
    progress: (res) =>
      onProgress({
        model: 'vosk',
        fraction: res.bytesWritten / res.contentLength,
        bytesWritten: res.bytesWritten,
        totalBytes: res.contentLength,
      }),
  });

  const result = await dl.promise;
  if (result.statusCode !== 200) {
    throw new Error(`Vosk download failed: HTTP ${result.statusCode}`);
  }

  await unzip(zipPath, DOCS_DIR);
  await unlink(zipPath);
}

export async function downloadLLM(
  onProgress: (p: DownloadProgress) => void,
): Promise<void> {
  const dl = downloadFile({
    fromUrl: LLM_URL,
    toFile: LLM_MODEL_PATH,
    progressDivider: 1,
    progress: (res) =>
      onProgress({
        model: 'llm',
        fraction: res.bytesWritten / res.contentLength,
        bytesWritten: res.bytesWritten,
        totalBytes: res.contentLength,
      }),
  });

  const result = await dl.promise;
  if (result.statusCode !== 200) {
    throw new Error(`LLM download failed: HTTP ${result.statusCode}`);
  }
}
