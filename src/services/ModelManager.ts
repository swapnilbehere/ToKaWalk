import { Platform } from 'react-native';
import {
  DocumentDirectoryPath,
  ExternalDirectoryPath,
  exists,
  downloadFile,
} from 'react-native-fs';

const DOCS_DIR =
  Platform.OS === 'ios' ? DocumentDirectoryPath : ExternalDirectoryPath;

export const LLM_MODEL_PATH = `${DOCS_DIR}/qwen2.5-1.5b-instruct-q4_k_m.gguf`;

// Qwen2.5-1.5B-Instruct Q4_K_M (~900 MB) — fits comfortably in 2 GB free RAM
const LLM_URL =
  'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf';

export interface DownloadProgress {
  /** 0–1 */
  fraction: number;
  bytesWritten: number;
  totalBytes: number;
}

export async function checkLLMReady(): Promise<boolean> {
  return exists(LLM_MODEL_PATH);
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
