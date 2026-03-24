import { useState, useCallback, useEffect } from 'react';
import {
  checkModelsReady,
  downloadVosk,
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
  | 'downloading-vosk'
  | 'downloading-llm'
  | 'ready'
  | 'error';

export interface ModelSetupState {
  status: SetupStatus;
  voskProgress: number;  // 0–1
  llmProgress: number;   // 0–1
  errorMessage: string | null;
}

export function useModelSetup() {
  const [state, setState] = useState<ModelSetupState>({
    status: 'checking',
    voskProgress: 0,
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

      // Step 2: models
      const { vosk, llm } = await checkModelsReady();

      if (!vosk) {
        setState(s => ({ ...s, status: 'downloading-vosk' }));
        await downloadVosk((p: DownloadProgress) =>
          setState(s => ({ ...s, voskProgress: p.fraction })),
        );
      }

      if (!llm) {
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
