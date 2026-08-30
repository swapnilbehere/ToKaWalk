import { Platform } from 'react-native';
import {
  DocumentDirectoryPath,
  ExternalDirectoryPath,
  exists,
  stat,
  unlink,
  downloadFile,
} from 'react-native-fs';

const DOCS_DIR =
  Platform.OS === 'ios' ? DocumentDirectoryPath : ExternalDirectoryPath;

export const LLM_MODEL_PATH = `${DOCS_DIR}/qwen2.5-1.5b-instruct-q4_k_m.gguf`;

// Qwen2.5-1.5B-Instruct Q4_K_M — the real file is ~1.12 GB. An interrupted
// download leaves a truncated file that exists() happily accepts; llama.rn then
// fails to load it at runtime with no recovery. Treat anything well under the
// real size as absent so the download is retried.
const MIN_MODEL_BYTES = 1_000_000_000;

const LLM_URL =
  'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf';

export interface DownloadProgress {
  /** 0–1 */
  fraction: number;
  bytesWritten: number;
  totalBytes: number;
}

/**
 * True only when a fully-downloaded model is present. A partial file is deleted
 * so the caller falls through to {@link downloadLLM}.
 */
export async function checkLLMReady(): Promise<boolean> {
  if (!(await exists(LLM_MODEL_PATH))) return false;
  try {
    const info = await stat(LLM_MODEL_PATH);
    if (Number(info.size) >= MIN_MODEL_BYTES) return true;
    console.warn('[ModelManager] Model file is truncated, deleting', { size: info.size });
    await unlink(LLM_MODEL_PATH).catch(() => {});
    return false;
  } catch (e) {
    console.warn('[ModelManager] stat failed, treating model as not ready', e);
    return false;
  }
}

export async function downloadLLM(
  onProgress: (p: DownloadProgress) => void,
): Promise<void> {
  const dl = downloadFile({
    fromUrl: LLM_URL,
    toFile: LLM_MODEL_PATH,
    progressDivider: 1,
    progress: (res) => {
      const total = res.contentLength > 0 ? res.contentLength : 0;
      onProgress({
        fraction: total > 0 ? Math.min(1, res.bytesWritten / total) : 0,
        bytesWritten: res.bytesWritten,
        totalBytes: total,
      });
    },
  });

  const result = await dl.promise;
  if (result.statusCode !== 200) {
    throw new Error(`LLM download failed: HTTP ${result.statusCode}`);
  }
}
