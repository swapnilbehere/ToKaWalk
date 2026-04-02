export type SessionMode = 'just-walk' | 'brain-dump' | 'journal' | 'learn';
export type LLMMode = 'local' | 'online';
export type InputMode = 'voice' | 'text';
export type SpeakerRole = 'user' | 'ai';
export type TurnStatus = 'completed' | 'interrupted';
export type VADSensitivity = 'indoor' | 'outdoor';
export type ConversationState =
  | 'idle'
  | 'listening'
  | 'processing'
  | 'speaking'
  | 'recovering'
  | 'degraded';

export type STTErrorKind =
  | 'no_match'
  | 'partial_no_final'
  | 'client_error'
  | 'network_error'
  | 'unavailable'
  | 'unknown';

export interface STTErrorInfo {
  kind: STTErrorKind;
  message: string;
  code?: string;
  partialText?: string;
  sawFinalResult: boolean;
}

export interface Turn {
  id: number;
  sessionId: number;
  speaker: SpeakerRole;
  text: string;
  timestamp: number;
  status: TurnStatus;
}

export interface Session {
  id: number;
  mode: SessionMode;
  startedAt: number;
  endedAt: number | null;
  durationSecs: number | null;
  modelUsed: LLMMode;
}

export interface Summary {
  id: number;
  sessionId: number;
  summaryText: string;
  generatedAt: number;
}

export interface Preferences {
  vadSensitivity: VADSensitivity;
  defaultMode: SessionMode;
  llmMode: LLMMode;
  groqApiKey: string;
  ttsRate: number;
  hasSeenOnlineTooltip: boolean;
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}
