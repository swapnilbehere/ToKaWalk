import { useState, useCallback, useEffect } from 'react';
import {
  checkLLMReady,
  downloadLLM,
  DownloadProgress,
} from '../services/ModelManager';
import {
  requestAllPermissions,
  allGranted,
} from '../services/PermissionService';

export type SetupStatus =
  | 'checking'
  | 'requesting-permissions'
  | 'permissions-denied'
  | 'downloading-llm'
  | 'ready'
  | 'error';

export interface ModelSetupState {
  status: SetupStatus;
  llmProgress: number;   // 0–1
  errorMessage: string | null;
}

export function useModelSetup() {
  const [state, setState] = useState<ModelSetupState>({
    status: 'checking',
    llmProgress: 0,
    errorMessage: null,
  });

  const run = useCallback(async () => {
    setState(s => ({ ...s, status: 'checking', errorMessage: null }));

    try {
      // Step 1: permissions
      setState(s => ({ ...s, status: 'requesting-permissions' }));
      const perms = await requestAllPermissions();
      if (!allGranted(perms)) {
        setState(s => ({ ...s, status: 'permissions-denied' }));
        return;
      }

      // Step 2: LLM model
      const llmReady = await checkLLMReady();
      if (!llmReady) {
        setState(s => ({ ...s, status: 'downloading-llm' }));
        await downloadLLM((p: DownloadProgress) =>
          setState(s => ({ ...s, llmProgress: p.fraction })),
        );
      }

      setState(s => ({ ...s, status: 'ready' }));
    } catch (e: any) {
      setState(s => ({
        ...s,
        status: 'error',
        errorMessage: e?.message ?? 'Download failed. Check your connection.',
      }));
    }
  }, []);

  useEffect(() => { run(); }, [run]);

  return { ...state, retry: run };
}
