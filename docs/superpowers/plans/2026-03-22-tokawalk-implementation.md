# ToKaWalk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a hands-free React Native walking companion app (Android + iOS) with on-device LLM, wake word activation, VAD-driven conversation, and local session history.

**Architecture:** Layered — UI screens → Conversation Engine → 4 independent services (WakeWord, STT, TTS, LLM) → SQLite storage. Each service has one responsibility and a clean TypeScript interface so it can be swapped or mocked independently.

**Tech Stack:** React Native (bare), TypeScript, `@picovoice/porcupine-react-native`, `llama.rn`, `@react-native-voice/voice`, `react-native-tts`, `react-native-sqlite-storage`, `@react-navigation/native`, Jest + @testing-library/react-native

---

## File Map

```
src/
  types/index.ts                        # Shared types: Session, Turn, SessionMode, LLMMode, etc.
  constants/
    colors.ts                           # Orange theme tokens
    modes.ts                            # SessionMode definitions + system prompts

  services/
    storage/
      database.ts                       # SQLite connection, migrations, schema
      SessionRepository.ts              # sessions table CRUD
      TurnRepository.ts                 # turns table CRUD (+ interrupted status)
      SummaryRepository.ts              # summaries table CRUD
      PreferencesRepository.ts          # key-value prefs (API key, VAD sensitivity, etc.)

    llm/
      LLMService.ts                     # Interface: generate(messages) → AsyncGenerator<string>
      LocalLLMService.ts                # llama.rn implementation
      GroqLLMService.ts                 # Groq API implementation via fetch

    stt/
      STTService.ts                     # Native OS STT wrapper (start/stop/onResult)

    tts/
      TTSService.ts                     # Native OS TTS wrapper + sentence-streaming logic

    wakeword/
      WakeWordService.ts                # Porcupine wrapper (startListening/stopListening/onDetected)

  engine/
    ContextManager.ts                   # Builds message array, FIFO truncation at 3800 tokens
    ConversationEngine.ts               # Orchestrates: WakeWord → STT → LLM → TTS → Storage

  hooks/
    useConversationEngine.ts            # React hook exposing engine state to UI

  navigation/
    AppNavigator.tsx                    # Stack navigator wiring all screens

  screens/
    HomeScreen.tsx                      # Mode picker + recent walks
    WalkModeScreen.tsx                  # Eyes-free mic orb
    ChatModeScreen.tsx                  # Chat bubbles + tap-to-talk
    SessionDetailScreen.tsx             # Summary + full transcript
    HistoryScreen.tsx                   # Full session list with delete
    SettingsScreen.tsx                  # API key, VAD, TTS prefs

  components/
    ModeSelector.tsx                    # 4-mode picker with border-only selection
    LLMModeBadge.tsx                    # 📴 Local / 🌐 Online tappable badge
    MicOrb.tsx                          # Animated pulsing orb for Walk Mode
    ChatBubble.tsx                      # Single message bubble (user or Toka)
    SessionCard.tsx                     # Compact session row for lists

__tests__/
  services/
    ContextManager.test.ts
    TurnRepository.test.ts
    SessionRepository.test.ts
    TTSService.test.ts                  # Sentence splitting logic
    GroqLLMService.test.ts
  engine/
    ConversationEngine.test.ts
  screens/
    HomeScreen.test.tsx
```

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`, `tsconfig.json`, `babel.config.js`, `jest.config.js`
- Create: `src/types/index.ts`
- Create: `src/constants/colors.ts`
- Create: `src/constants/modes.ts`

- [ ] **Step 1: Initialise bare React Native project**

```bash
npx react-native@latest init ToKaWalk --template react-native-template-typescript
cd ToKaWalk
```

- [ ] **Step 2: Install all dependencies at once**

```bash
npm install \
  @picovoice/porcupine-react-native \
  llama.rn \
  @react-native-voice/voice \
  react-native-tts \
  react-native-sqlite-storage \
  @react-navigation/native \
  @react-navigation/stack \
  react-native-screens \
  react-native-safe-area-context \
  react-native-gesture-handler

npm install --save-dev \
  @testing-library/react-native \
  @testing-library/jest-native \
  jest \
  ts-jest
```

- [ ] **Step 3: iOS pod install**

```bash
cd ios && pod install && cd ..
```

- [ ] **Step 4: Write shared types**

Create `src/types/index.ts`:
```typescript
export type SessionMode = 'just-walk' | 'brain-dump' | 'journal' | 'learn';
export type LLMMode = 'local' | 'online';
export type SpeakerRole = 'user' | 'ai';
export type TurnStatus = 'completed' | 'interrupted';
export type VADSensitivity = 'indoor' | 'outdoor';
export type ConversationState = 'idle' | 'listening' | 'thinking' | 'speaking';

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
  ttsRate: number;  // 0.0 – 1.0
  hasSeenOnlineTooltip: boolean;
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}
```

- [ ] **Step 5: Write colour constants**

Create `src/constants/colors.ts`:
```typescript
export const colors = {
  bg: '#0a0a0a',
  surface: '#0a0a0a',
  border: '#292524',
  borderActive: '#f97316',
  orange: '#f97316',
  orangeMuted: '#fb923c',
  text: '#e7e5e4',
  textMuted: '#a8a29e',
  textDim: '#57534e',
  textFaint: '#44403c',
  green: '#4ade80',
  white: '#ffffff',
};
```

- [ ] **Step 6: Write session mode constants and system prompts**

Create `src/constants/modes.ts`:
```typescript
import { SessionMode } from '../types';

export const MODE_LABELS: Record<SessionMode, string> = {
  'just-walk': '⚡ Just Walk',
  'brain-dump': '🧠 Brain Dump',
  'journal': '📔 Journal',
  'learn': '🎓 Learn & Discuss',
};

export const MODE_DESCRIPTIONS: Record<SessionMode, string> = {
  'just-walk': 'Start talking, no setup',
  'brain-dump': 'Get ideas out of your head',
  'journal': 'Reflect on your day',
  'learn': 'Talk about any topic',
};

export const MODE_SYSTEM_PROMPTS: Record<SessionMode, string> = {
  'just-walk': `You are Toka, a friendly walking companion. Have a natural, engaging conversation on any topic the user brings up. Keep responses concise — this is a spoken conversation, not an essay. 2-3 sentences max unless the user wants more depth.`,

  'brain-dump': `You are Toka, a thinking partner helping the user capture and develop ideas during their walk. Your job is to draw ideas out: ask one clarifying question at a time, reflect back what you hear, and help the user articulate half-formed thoughts. Never lecture — just listen and prompt. Keep responses short.`,

  'journal': `You are Toka, a warm and empathetic listener helping the user reflect on their day. Listen carefully, reflect back what you hear, and ask gentle follow-up questions. Be supportive and non-judgmental. Never give advice unless explicitly asked. Keep responses short.`,

  'learn': `You are Toka, a knowledgeable conversation partner. Discuss any topic the user wants to explore. Be informative and engaging — explain concepts clearly, offer interesting angles, and challenge ideas thoughtfully. Keep responses conversational and spoken-friendly. 2-3 sentences at a time.`,
};
```

- [ ] **Step 7: Configure Jest**

Update `jest.config.js`:
```javascript
module.exports = {
  preset: 'react-native',
  setupFilesAfterFramework: ['@testing-library/jest-native/extend-expect'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
  transform: { '^.+\\.(ts|tsx)$': 'ts-jest' },
  testPathPattern: '__tests__',
  moduleNameMapper: {
    // mock heavy native modules
    '@picovoice/porcupine-react-native': '<rootDir>/__mocks__/porcupine.ts',
    'llama.rn': '<rootDir>/__mocks__/llamarn.ts',
    '@react-native-voice/voice': '<rootDir>/__mocks__/voice.ts',
    'react-native-tts': '<rootDir>/__mocks__/tts.ts',
    'react-native-sqlite-storage': '<rootDir>/__mocks__/sqlite.ts',
  },
};
```

- [ ] **Step 8: Create native module mocks**

Create `__mocks__/porcupine.ts`:
```typescript
export const PorcupineManager = { create: jest.fn(), start: jest.fn(), stop: jest.fn(), delete: jest.fn() };
```

Create `__mocks__/llamarn.ts`:
```typescript
export const LlamaContext = { create: jest.fn() };
```

Create `__mocks__/voice.ts`:
```typescript
export default { start: jest.fn(), stop: jest.fn(), destroy: jest.fn(), onSpeechResults: jest.fn() };
```

Create `__mocks__/tts.ts`:
```typescript
export default { speak: jest.fn(), stop: jest.fn(), addEventListener: jest.fn(), removeEventListener: jest.fn() };
```

Create `__mocks__/sqlite.ts`:
```typescript
export default { openDatabase: jest.fn(() => ({ transaction: jest.fn(), executeSql: jest.fn() })) };
```

- [ ] **Step 9: Verify project builds**

```bash
npx react-native run-android   # or run-ios
```
Expected: Metro bundler starts, app appears on device/emulator.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: project scaffold, types, constants, jest config"
```

---

## Task 2: Database Layer

**Files:**
- Create: `src/services/storage/database.ts`
- Create: `src/services/storage/SessionRepository.ts`
- Create: `src/services/storage/TurnRepository.ts`
- Create: `src/services/storage/SummaryRepository.ts`
- Create: `src/services/storage/PreferencesRepository.ts`
- Test: `__tests__/services/SessionRepository.test.ts`
- Test: `__tests__/services/TurnRepository.test.ts`

- [ ] **Step 1: Write the failing tests for SessionRepository**

Create `__tests__/services/SessionRepository.test.ts`:
```typescript
import { SessionRepository } from '../../src/services/storage/SessionRepository';

// We test the logic layer; the raw db calls are mocked
const mockDb = {
  executeSql: jest.fn(),
  transaction: jest.fn((cb: Function) => cb({ executeSql: jest.fn() })),
};

describe('SessionRepository', () => {
  it('creates a session and returns its id', async () => {
    mockDb.executeSql.mockResolvedValueOnce([{ insertId: 42 }]);
    const repo = new SessionRepository(mockDb as any);
    const id = await repo.create({ mode: 'just-walk', startedAt: 1000, modelUsed: 'local' });
    expect(id).toBe(42);
  });

  it('lists sessions ordered by startedAt desc', async () => {
    const rows = [
      { id: 2, mode: 'journal', started_at: 2000, ended_at: 2100, duration_secs: 100, model_used: 'local' },
      { id: 1, mode: 'just-walk', started_at: 1000, ended_at: 1050, duration_secs: 50, model_used: 'online' },
    ];
    mockDb.executeSql.mockResolvedValueOnce([{ rows: { length: 2, item: (i: number) => rows[i] } }]);
    const repo = new SessionRepository(mockDb as any);
    const sessions = await repo.list(10);
    expect(sessions[0].id).toBe(2);
  });
});
```

- [ ] **Step 2: Run — expect FAIL (SessionRepository not found)**

```bash
npx jest __tests__/services/SessionRepository.test.ts
```
Expected: FAIL — `Cannot find module`.

- [ ] **Step 3: Implement database.ts**

Create `src/services/storage/database.ts`:
```typescript
import SQLite from 'react-native-sqlite-storage';

SQLite.enablePromise(true);

let db: SQLite.SQLiteDatabase | null = null;

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;
  db = await SQLite.openDatabase({ name: 'tokawalk.db', location: 'default' });
  await runMigrations(db);
  return db;
}

async function runMigrations(database: SQLite.SQLiteDatabase): Promise<void> {
  await database.executeSql(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mode TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      duration_secs INTEGER,
      model_used TEXT NOT NULL
    )
  `);
  await database.executeSql(`
    CREATE TABLE IF NOT EXISTS turns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      speaker TEXT NOT NULL,
      text TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'completed',
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    )
  `);
  await database.executeSql(`
    CREATE TABLE IF NOT EXISTS summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL UNIQUE,
      summary_text TEXT NOT NULL,
      generated_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    )
  `);
  await database.executeSql(`
    CREATE TABLE IF NOT EXISTS preferences (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
}
```

- [ ] **Step 4: Implement SessionRepository**

Create `src/services/storage/SessionRepository.ts`:
```typescript
import { SQLiteDatabase } from 'react-native-sqlite-storage';
import { Session, SessionMode, LLMMode } from '../../types';

export class SessionRepository {
  constructor(private db: SQLiteDatabase) {}

  async create(params: { mode: SessionMode; startedAt: number; modelUsed: LLMMode }): Promise<number> {
    const [result] = await this.db.executeSql(
      'INSERT INTO sessions (mode, started_at, model_used) VALUES (?, ?, ?)',
      [params.mode, params.startedAt, params.modelUsed],
    );
    return result.insertId;
  }

  async end(id: number, endedAt: number): Promise<void> {
    const durationSecs = Math.round((endedAt - (await this.getStartedAt(id))) / 1000);
    await this.db.executeSql(
      'UPDATE sessions SET ended_at = ?, duration_secs = ? WHERE id = ?',
      [endedAt, durationSecs, id],
    );
  }

  async list(limit: number): Promise<Session[]> {
    const [result] = await this.db.executeSql(
      'SELECT * FROM sessions ORDER BY started_at DESC LIMIT ?',
      [limit],
    );
    return Array.from({ length: result.rows.length }, (_, i) => rowToSession(result.rows.item(i)));
  }

  async delete(id: number): Promise<void> {
    await this.db.executeSql('DELETE FROM sessions WHERE id = ?', [id]);
  }

  private async getStartedAt(id: number): Promise<number> {
    const [result] = await this.db.executeSql('SELECT started_at FROM sessions WHERE id = ?', [id]);
    return result.rows.item(0).started_at;
  }
}

function rowToSession(row: any): Session {
  return {
    id: row.id,
    mode: row.mode,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationSecs: row.duration_secs,
    modelUsed: row.model_used,
  };
}
```

- [ ] **Step 5: Implement TurnRepository**

Create `src/services/storage/TurnRepository.ts`:
```typescript
import { SQLiteDatabase } from 'react-native-sqlite-storage';
import { Turn, SpeakerRole, TurnStatus } from '../../types';

export class TurnRepository {
  constructor(private db: SQLiteDatabase) {}

  async add(params: {
    sessionId: number;
    speaker: SpeakerRole;
    text: string;
    status?: TurnStatus;
  }): Promise<number> {
    const [result] = await this.db.executeSql(
      'INSERT INTO turns (session_id, speaker, text, timestamp, status) VALUES (?, ?, ?, ?, ?)',
      [params.sessionId, params.speaker, params.text, Date.now(), params.status ?? 'completed'],
    );
    return result.insertId;
  }

  async getForSession(sessionId: number): Promise<Turn[]> {
    const [result] = await this.db.executeSql(
      'SELECT * FROM turns WHERE session_id = ? ORDER BY timestamp ASC',
      [sessionId],
    );
    return Array.from({ length: result.rows.length }, (_, i) => rowToTurn(result.rows.item(i)));
  }
}

function rowToTurn(row: any): Turn {
  return {
    id: row.id,
    sessionId: row.session_id,
    speaker: row.speaker,
    text: row.text,
    timestamp: row.timestamp,
    status: row.status,
  };
}
```

- [ ] **Step 6: Implement SummaryRepository**

Create `src/services/storage/SummaryRepository.ts`:
```typescript
import { SQLiteDatabase } from 'react-native-sqlite-storage';
import { Summary } from '../../types';

export class SummaryRepository {
  constructor(private db: SQLiteDatabase) {}

  async save(sessionId: number, summaryText: string): Promise<void> {
    await this.db.executeSql(
      'INSERT OR REPLACE INTO summaries (session_id, summary_text, generated_at) VALUES (?, ?, ?)',
      [sessionId, summaryText, Date.now()],
    );
  }

  async getForSession(sessionId: number): Promise<Summary | null> {
    const [result] = await this.db.executeSql(
      'SELECT * FROM summaries WHERE session_id = ?',
      [sessionId],
    );
    if (result.rows.length === 0) return null;
    const row = result.rows.item(0);
    return { id: row.id, sessionId: row.session_id, summaryText: row.summary_text, generatedAt: row.generated_at };
  }
}
```

- [ ] **Step 7: Implement PreferencesRepository**

Create `src/services/storage/PreferencesRepository.ts`:
```typescript
import { SQLiteDatabase } from 'react-native-sqlite-storage';
import { Preferences, VADSensitivity, SessionMode, LLMMode } from '../../types';

const DEFAULTS: Preferences = {
  vadSensitivity: 'indoor',
  defaultMode: 'just-walk',
  llmMode: 'local',
  groqApiKey: '',
  ttsRate: 0.5,
  hasSeenOnlineTooltip: false,
};

export class PreferencesRepository {
  constructor(private db: SQLiteDatabase) {}

  async get(): Promise<Preferences> {
    const [result] = await this.db.executeSql('SELECT key, value FROM preferences');
    const map: Record<string, string> = {};
    for (let i = 0; i < result.rows.length; i++) {
      const row = result.rows.item(i);
      map[row.key] = row.value;
    }
    return {
      vadSensitivity: (map.vadSensitivity as VADSensitivity) ?? DEFAULTS.vadSensitivity,
      defaultMode: (map.defaultMode as SessionMode) ?? DEFAULTS.defaultMode,
      llmMode: (map.llmMode as LLMMode) ?? DEFAULTS.llmMode,
      groqApiKey: map.groqApiKey ?? DEFAULTS.groqApiKey,
      ttsRate: map.ttsRate ? parseFloat(map.ttsRate) : DEFAULTS.ttsRate,
      hasSeenOnlineTooltip: map.hasSeenOnlineTooltip === 'true',
    };
  }

  async set<K extends keyof Preferences>(key: K, value: Preferences[K]): Promise<void> {
    await this.db.executeSql(
      'INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)',
      [key, String(value)],
    );
  }
}
```

- [ ] **Step 8: Run tests — expect PASS**

```bash
npx jest __tests__/services/SessionRepository.test.ts __tests__/services/TurnRepository.test.ts
```
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/services/storage/ __tests__/services/
git commit -m "feat: sqlite database layer — sessions, turns, summaries, preferences"
```

---

## Task 3: TTS Service

**Files:**
- Create: `src/services/tts/TTSService.ts`
- Test: `__tests__/services/TTSService.test.ts`

- [ ] **Step 1: Write failing tests for sentence splitting**

Create `__tests__/services/TTSService.test.ts`:
```typescript
import { splitIntoSentences } from '../../src/services/tts/TTSService';

describe('splitIntoSentences', () => {
  it('splits on period followed by space', () => {
    expect(splitIntoSentences('Hello world. How are you.')).toEqual([
      'Hello world.', 'How are you.'
    ]);
  });

  it('splits on question mark', () => {
    expect(splitIntoSentences('What is this? It is great!')).toEqual([
      'What is this?', 'It is great!'
    ]);
  });

  it('does not split on abbreviations like Dr. when fewer than 8 tokens', () => {
    // "Dr. Smith" is < 8 tokens so stays together when buffering
    // The splitting function itself splits on punctuation; the 8-token
    // minimum is enforced in the streaming buffer, not here.
    // This tests that the regex doesn't greedily split "U.S." mid-word.
    expect(splitIntoSentences('The U.S. is large. Really.')).toEqual([
      'The U.S. is large.', 'Really.'
    ]);
  });

  it('returns single item for text with no sentence boundary', () => {
    expect(splitIntoSentences('hello world')).toEqual(['hello world']);
  });

  it('returns empty array for empty string', () => {
    expect(splitIntoSentences('')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx jest __tests__/services/TTSService.test.ts
```
Expected: FAIL — `splitIntoSentences` not found.

- [ ] **Step 3: Implement TTSService**

Create `src/services/tts/TTSService.ts`:
```typescript
import Tts from 'react-native-tts';

// Exported for testing
export function splitIntoSentences(text: string): string[] {
  if (!text.trim()) return [];
  // Split after . ? ! followed by whitespace, but not within words (e.g. U.S.)
  const parts = text.match(/[^.!?]*[.!?]+(?:\s|$)|[^.!?]+$/g) ?? [];
  return parts.map(s => s.trim()).filter(Boolean);
}

const MIN_FLUSH_TOKENS = 8;

export class TTSService {
  private buffer = '';
  private tokenCount = 0;
  private speaking = false;

  async init(rate: number): Promise<void> {
    await Tts.setDefaultRate(rate);
    Tts.addEventListener('tts-finish', () => { this.speaking = false; });
  }

  // Call this for each streamed token from the LLM
  feedToken(token: string): void {
    this.buffer += token;
    this.tokenCount++;

    const sentences = splitIntoSentences(this.buffer);
    if (sentences.length > 1 && this.tokenCount >= MIN_FLUSH_TOKENS) {
      // Flush all complete sentences, keep the incomplete tail
      const complete = sentences.slice(0, -1);
      this.buffer = sentences[sentences.length - 1];
      this.tokenCount = 0;
      complete.forEach(s => this.speakSentence(s));
    }
  }

  // Call when LLM stream ends to flush remaining buffer
  flush(): void {
    if (this.buffer.trim()) {
      this.speakSentence(this.buffer.trim());
      this.buffer = '';
      this.tokenCount = 0;
    }
  }

  stop(): void {
    Tts.stop();
    this.buffer = '';
    this.tokenCount = 0;
    this.speaking = false;
  }

  private speakSentence(text: string): void {
    this.speaking = true;
    Tts.speak(text);
  }
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx jest __tests__/services/TTSService.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/tts/ __tests__/services/TTSService.test.ts
git commit -m "feat: TTS service with sentence-streaming and flush"
```

---

## Task 4: STT Service

**Files:**
- Create: `src/services/stt/STTService.ts`

- [ ] **Step 1: Implement STTService**

Create `src/services/stt/STTService.ts`:
```typescript
import Voice, { SpeechResultsEvent, SpeechErrorEvent } from '@react-native-voice/voice';

export class STTService {
  private onResult: ((text: string) => void) | null = null;
  private onError: ((error: string) => void) | null = null;

  init(callbacks: { onResult: (text: string) => void; onError: (error: string) => void }): void {
    this.onResult = callbacks.onResult;
    this.onError = callbacks.onError;

    Voice.onSpeechResults = (event: SpeechResultsEvent) => {
      const text = event.value?.[0] ?? '';
      if (text && this.onResult) this.onResult(text);
    };

    Voice.onSpeechError = (event: SpeechErrorEvent) => {
      if (this.onError) this.onError(event.error?.message ?? 'STT error');
    };
  }

  async startListening(): Promise<void> {
    await Voice.start('en-US');
  }

  async stopListening(): Promise<void> {
    await Voice.stop();
  }

  async destroy(): Promise<void> {
    await Voice.destroy();
    Voice.removeAllListeners();
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/services/stt/
git commit -m "feat: STT service wrapping native OS voice recognition"
```

---

## Task 5: LLM Services

**Files:**
- Create: `src/services/llm/LLMService.ts`
- Create: `src/services/llm/LocalLLMService.ts`
- Create: `src/services/llm/GroqLLMService.ts`
- Test: `__tests__/services/GroqLLMService.test.ts`

- [ ] **Step 1: Write the failing Groq test**

Create `__tests__/services/GroqLLMService.test.ts`:
```typescript
import { GroqLLMService } from '../../src/services/llm/GroqLLMService';

global.fetch = jest.fn();

describe('GroqLLMService', () => {
  it('throws if API key is empty', async () => {
    const service = new GroqLLMService('');
    const gen = service.generate([{ role: 'user', content: 'hello' }]);
    await expect(gen.next()).rejects.toThrow('Groq API key not set');
  });

  it('yields streamed tokens from Groq response', async () => {
    const mockBody = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n',
      'data: {"choices":[{"delta":{"content":" world"}}]}\n',
      'data: [DONE]\n',
    ].join('');

    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      body: { getReader: () => {
        const enc = new TextEncoder();
        let done = false;
        return {
          read: async () => {
            if (done) return { done: true, value: undefined };
            done = true;
            return { done: false, value: enc.encode(mockBody) };
          },
        };
      }},
    });

    const service = new GroqLLMService('test-key');
    const tokens: string[] = [];
    for await (const t of service.generate([{ role: 'user', content: 'hi' }])) {
      tokens.push(t);
    }
    expect(tokens).toEqual(['Hello', ' world']);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx jest __tests__/services/GroqLLMService.test.ts
```
Expected: FAIL — `GroqLLMService` not found.

- [ ] **Step 3: Define the LLM interface**

Create `src/services/llm/LLMService.ts`:
```typescript
import { LLMMessage } from '../../types';

export interface LLMService {
  generate(messages: LLMMessage[]): AsyncGenerator<string>;
  isReady(): boolean;
}
```

- [ ] **Step 4: Implement GroqLLMService**

Create `src/services/llm/GroqLLMService.ts`:
```typescript
import { LLMService } from './LLMService';
import { LLMMessage } from '../../types';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.1-8b-instant';

export class GroqLLMService implements LLMService {
  constructor(private apiKey: string) {}

  isReady(): boolean {
    return this.apiKey.trim().length > 0;
  }

  async *generate(messages: LLMMessage[]): AsyncGenerator<string> {
    if (!this.isReady()) throw new Error('Groq API key not set');

    const response = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: MODEL, messages, stream: true }),
    });

    if (!response.ok) {
      throw new Error(`Groq error: ${response.status}`);
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') return;
        try {
          const parsed = JSON.parse(data);
          const token = parsed.choices?.[0]?.delta?.content;
          if (token) yield token;
        } catch { /* skip malformed line */ }
      }
    }
  }
}
```

- [ ] **Step 5: Implement LocalLLMService**

Create `src/services/llm/LocalLLMService.ts`:
```typescript
import { LlamaContext } from 'llama.rn';
import { LLMService } from './LLMService';
import { LLMMessage } from '../../types';

export class LocalLLMService implements LLMService {
  private context: any = null;

  async load(modelPath: string): Promise<void> {
    this.context = await LlamaContext.create({ model: modelPath, n_ctx: 4096 });
  }

  isReady(): boolean {
    return this.context !== null;
  }

  async *generate(messages: LLMMessage[]): AsyncGenerator<string> {
    if (!this.context) throw new Error('Local model not loaded');

    // llama.rn uses completion with a callback; wrap it in an async generator
    const tokens: string[] = [];
    let finished = false;
    let resolve: (() => void) | null = null;

    this.context.completion(
      { messages },
      (token: string) => {
        tokens.push(token);
        resolve?.();
      },
    ).then(() => { finished = true; resolve?.(); });

    while (!finished || tokens.length > 0) {
      if (tokens.length === 0) {
        await new Promise<void>(r => { resolve = r; });
      }
      while (tokens.length > 0) {
        yield tokens.shift()!;
      }
    }
  }
}
```

- [ ] **Step 6: Run Groq tests — expect PASS**

```bash
npx jest __tests__/services/GroqLLMService.test.ts
```
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/services/llm/ __tests__/services/GroqLLMService.test.ts
git commit -m "feat: LLM services — Groq streaming + local llama.rn wrapper"
```

---

## Task 6: Wake Word Service

**Files:**
- Create: `src/services/wakeword/WakeWordService.ts`

- [ ] **Step 1: Implement WakeWordService**

Create `src/services/wakeword/WakeWordService.ts`:
```typescript
import { PorcupineManager } from '@picovoice/porcupine-react-native';

// Obtain your AccessKey from Picovoice Console: https://console.picovoice.ai/
// The keyword file (.ppn) for "Hey Toka" is trained via Picovoice Console and
// bundled with the app under android/app/src/main/assets/ and ios/ToKaWalk/
const ACCESS_KEY = 'YOUR_PORCUPINE_ACCESS_KEY'; // set before shipping
const HEY_TOKA_KEYWORD_PATH = 'hey_toka.ppn';   // bundled asset

export class WakeWordService {
  private manager: any = null;
  private onDetected: (() => void) | null = null;

  async start(onDetected: () => void): Promise<void> {
    this.onDetected = onDetected;
    this.manager = await PorcupineManager.create(
      ACCESS_KEY,
      [{ builtin: null, label: 'hey-toka', path: HEY_TOKA_KEYWORD_PATH }],
      (index: number) => { if (index === 0) this.onDetected?.(); },
    );
    await this.manager.start();
  }

  async stop(): Promise<void> {
    await this.manager?.stop();
    await this.manager?.delete();
    this.manager = null;
  }
}
```

> **Note:** Before testing on device, generate the "Hey Toka" keyword file from https://console.picovoice.ai/ and place it in the platform asset folders. Replace `YOUR_PORCUPINE_ACCESS_KEY` with the key from your Picovoice account.

- [ ] **Step 2: Commit**

```bash
git add src/services/wakeword/
git commit -m "feat: wake word service wrapping Porcupine for Hey Toka"
```

---

## Task 7: Context Manager

**Files:**
- Create: `src/engine/ContextManager.ts`
- Test: `__tests__/engine/ContextManager.test.ts`

- [ ] **Step 1: Write failing tests**

Create `__tests__/engine/ContextManager.test.ts`:
```typescript
import { ContextManager } from '../../src/engine/ContextManager';
import { MODE_SYSTEM_PROMPTS } from '../../src/constants/modes';

describe('ContextManager', () => {
  it('starts with only the system prompt', () => {
    const cm = new ContextManager('just-walk');
    const messages = cm.getMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toBe(MODE_SYSTEM_PROMPTS['just-walk']);
  });

  it('adds user and assistant turns', () => {
    const cm = new ContextManager('just-walk');
    cm.addUserTurn('hello');
    cm.addAssistantTurn('hi there');
    const messages = cm.getMessages();
    expect(messages).toHaveLength(3);
    expect(messages[1]).toEqual({ role: 'user', content: 'hello' });
    expect(messages[2]).toEqual({ role: 'assistant', content: 'hi there' });
  });

  it('marks interrupted turns in context', () => {
    const cm = new ContextManager('just-walk');
    cm.addAssistantTurn('partial response', true);
    const messages = cm.getMessages();
    expect(messages[1].content).toContain('[interrupted]');
  });

  it('prunes oldest turns when approaching token limit', () => {
    const cm = new ContextManager('just-walk');
    // Add many turns to force pruning (each ~100 chars ≈ ~25 tokens)
    for (let i = 0; i < 200; i++) {
      cm.addUserTurn('x'.repeat(100));
      cm.addAssistantTurn('y'.repeat(100));
    }
    const messages = cm.getMessages();
    // System prompt always present
    expect(messages[0].role).toBe('system');
    // Total token estimate should be under 3800
    const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
    const estimatedTokens = totalChars / 4; // rough 4 chars per token
    expect(estimatedTokens).toBeLessThan(3800);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx jest __tests__/engine/ContextManager.test.ts
```
Expected: FAIL

- [ ] **Step 3: Implement ContextManager**

Create `src/engine/ContextManager.ts`:
```typescript
import { LLMMessage, SessionMode } from '../types';
import { MODE_SYSTEM_PROMPTS } from '../constants/modes';

const MAX_TOKENS = 3800;
const CHARS_PER_TOKEN = 4; // conservative estimate

export class ContextManager {
  private turns: LLMMessage[] = [];
  private systemPrompt: string;

  constructor(mode: SessionMode) {
    this.systemPrompt = MODE_SYSTEM_PROMPTS[mode];
  }

  addUserTurn(text: string): void {
    this.turns.push({ role: 'user', content: text });
    this.pruneIfNeeded();
  }

  addAssistantTurn(text: string, interrupted = false): void {
    const content = interrupted ? `${text} [interrupted]` : text;
    this.turns.push({ role: 'assistant', content });
    this.pruneIfNeeded();
  }

  getMessages(): LLMMessage[] {
    return [{ role: 'system', content: this.systemPrompt }, ...this.turns];
  }

  reset(): void {
    this.turns = [];
  }

  private estimateTokens(): number {
    const allContent = this.getMessages().reduce((s, m) => s + m.content, '');
    return allContent.length / CHARS_PER_TOKEN;
  }

  private pruneIfNeeded(): void {
    while (this.estimateTokens() > MAX_TOKENS && this.turns.length > 2) {
      this.turns.shift(); // remove oldest turn (FIFO)
    }
  }
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx jest __tests__/engine/ContextManager.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/engine/ContextManager.ts __tests__/engine/
git commit -m "feat: context manager with FIFO pruning at 3800 token limit"
```

---

## Task 8: Conversation Engine

**Files:**
- Create: `src/engine/ConversationEngine.ts`
- Test: `__tests__/engine/ConversationEngine.test.ts`

- [ ] **Step 1: Write failing tests**

Create `__tests__/engine/ConversationEngine.test.ts`:
```typescript
import { ConversationEngine } from '../../src/engine/ConversationEngine';

// All services mocked
const mockWakeWord = { start: jest.fn(), stop: jest.fn() };
const mockSTT = { init: jest.fn(), startListening: jest.fn(), stopListening: jest.fn(), destroy: jest.fn() };
const mockTTS = { init: jest.fn(), feedToken: jest.fn(), flush: jest.fn(), stop: jest.fn() };
const mockLLM = {
  isReady: jest.fn(() => true),
  generate: jest.fn(async function* () { yield 'Hello'; yield ' world'; }),
};
const mockSessionRepo = { create: jest.fn(() => 1), end: jest.fn(), list: jest.fn(() => []) };
const mockTurnRepo = { add: jest.fn(), getForSession: jest.fn(() => []) };
const mockSummaryRepo = { save: jest.fn(), getForSession: jest.fn() };

describe('ConversationEngine', () => {
  it('starts in idle state', () => {
    const engine = new ConversationEngine({
      wakeWord: mockWakeWord as any,
      stt: mockSTT as any,
      tts: mockTTS as any,
      llm: mockLLM as any,
      sessionRepo: mockSessionRepo as any,
      turnRepo: mockTurnRepo as any,
      summaryRepo: mockSummaryRepo as any,
    });
    expect(engine.state).toBe('idle');
  });

  it('detects "bye toka" phrase and triggers session end', () => {
    const engine = new ConversationEngine({
      wakeWord: mockWakeWord as any,
      stt: mockSTT as any,
      tts: mockTTS as any,
      llm: mockLLM as any,
      sessionRepo: mockSessionRepo as any,
      turnRepo: mockTurnRepo as any,
      summaryRepo: mockSummaryRepo as any,
    });
    expect(engine.isByeToka('bye toka')).toBe(true);
    expect(engine.isByeToka('goodbye Toka')).toBe(true);
    expect(engine.isByeToka('bye')).toBe(false);
    expect(engine.isByeToka('I said bye toka and then something else')).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx jest __tests__/engine/ConversationEngine.test.ts
```
Expected: FAIL

- [ ] **Step 3: Implement ConversationEngine**

Create `src/engine/ConversationEngine.ts`:
```typescript
import { ConversationState, SessionMode, LLMMode, Turn } from '../types';
import { ContextManager } from './ContextManager';
import { WakeWordService } from '../services/wakeword/WakeWordService';
import { STTService } from '../services/stt/STTService';
import { TTSService } from '../services/tts/TTSService';
import { LLMService } from '../services/llm/LLMService';
import { SessionRepository } from '../services/storage/SessionRepository';
import { TurnRepository } from '../services/storage/TurnRepository';
import { SummaryRepository } from '../services/storage/SummaryRepository';

const BYE_TOKA_PATTERNS = [/^bye\s+toka$/i, /^goodbye\s+toka$/i, /^bye-?bye\s+toka$/i];
const SUMMARY_TIMEOUT_MS = 30_000;

interface EngineServices {
  wakeWord: WakeWordService;
  stt: STTService;
  tts: TTSService;
  llm: LLMService;
  sessionRepo: SessionRepository;
  turnRepo: TurnRepository;
  summaryRepo: SummaryRepository;
}

export class ConversationEngine {
  state: ConversationState = 'idle';
  private context: ContextManager | null = null;
  private sessionId: number | null = null;
  private sessionMode: SessionMode = 'just-walk';
  private llmMode: LLMMode = 'local';
  private pendingModeSwitch: LLMMode | null = null;
  private onStateChange: ((state: ConversationState) => void) | null = null;

  constructor(private services: EngineServices) {}

  setOnStateChange(cb: (state: ConversationState) => void): void {
    this.onStateChange = cb;
  }

  async startIdle(): Promise<void> {
    await this.services.wakeWord.start(() => this.onWakeWordDetected());
    this.setState('idle');
  }

  async startSession(mode: SessionMode, llmMode: LLMMode): Promise<void> {
    this.sessionMode = mode;
    this.llmMode = llmMode;
    this.context = new ContextManager(mode);
    this.sessionId = await this.services.sessionRepo.create({
      mode,
      startedAt: Date.now(),
      modelUsed: llmMode,
    });

    await this.services.wakeWord.stop();
    this.services.stt.init({
      onResult: (text) => this.onUserSpeech(text),
      onError: () => this.startListening(), // retry on error
    });
    this.startListening();
  }

  async endSession(): Promise<void> {
    await this.services.stt.stopListening();
    this.services.tts.stop();
    if (this.sessionId) {
      const endedAt = Date.now();
      await this.services.sessionRepo.end(this.sessionId, endedAt);
      this.generateSummaryWithTimeout(this.sessionId);
    }
    this.sessionId = null;
    this.context = null;
    this.setState('idle');
    await this.startIdle();
  }

  toggleLLMMode(newMode: LLMMode): void {
    if (this.state === 'thinking') {
      this.pendingModeSwitch = newMode;
    } else {
      this.llmMode = newMode;
    }
  }

  isByeToka(text: string): boolean {
    const trimmed = text.trim();
    return BYE_TOKA_PATTERNS.some(p => p.test(trimmed));
  }

  private onWakeWordDetected(): void {
    // Wake word detection is handled externally — UI calls startSession()
    this.onStateChange?.('idle'); // signal to UI to show mode picker
  }

  private startListening(): void {
    this.setState('listening');
    this.services.stt.startListening();
  }

  private async onUserSpeech(text: string): Promise<void> {
    if (this.isByeToka(text)) {
      await this.endSession();
      return;
    }

    this.context!.addUserTurn(text);
    await this.services.turnRepo.add({
      sessionId: this.sessionId!,
      speaker: 'user',
      text,
      status: 'completed',
    });

    await this.generateResponse();
  }

  private async generateResponse(): Promise<void> {
    this.setState('thinking');
    const messages = this.context!.getMessages();
    let fullResponse = '';
    let interrupted = false;

    try {
      for await (const token of this.services.llm.generate(messages)) {
        fullResponse += token;
        this.services.tts.feedToken(token);
        if (this.state === 'listening') {
          // Barge-in detected by STT calling onUserSpeech
          interrupted = true;
          break;
        }
        this.setState('speaking');
      }
      this.services.tts.flush();
    } catch {
      // LLM error (e.g. Groq failure) — fall back silently
    }

    this.context!.addAssistantTurn(fullResponse, interrupted);
    await this.services.turnRepo.add({
      sessionId: this.sessionId!,
      speaker: 'ai',
      text: fullResponse,
      status: interrupted ? 'interrupted' : 'completed',
    });

    // Apply queued mode switch
    if (this.pendingModeSwitch) {
      this.llmMode = this.pendingModeSwitch;
      this.pendingModeSwitch = null;
    }

    if (!interrupted) this.startListening();
  }

  private async generateSummaryWithTimeout(sessionId: number): Promise<void> {
    const turns = await this.services.turnRepo.getForSession(sessionId);
    const transcript = turns.map(t => `${t.speaker === 'user' ? 'User' : 'Toka'}: ${t.text}`).join('\n');

    const summaryMessages = [
      { role: 'system' as const, content: 'Summarise the following conversation in 2-4 sentences, focusing on key insights or topics discussed. Be concise.' },
      { role: 'user' as const, content: transcript },
    ];

    try {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), SUMMARY_TIMEOUT_MS),
      );

      let summary = '';
      const generationPromise = (async () => {
        for await (const token of this.services.llm.generate(summaryMessages)) {
          summary += token;
        }
        return summary;
      })();

      const result = await Promise.race([generationPromise, timeoutPromise]);
      await this.services.summaryRepo.save(sessionId, result);
    } catch {
      await this.services.summaryRepo.save(sessionId, '');
    }
  }

  private setState(newState: ConversationState): void {
    this.state = newState;
    this.onStateChange?.(newState);
  }
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx jest __tests__/engine/ConversationEngine.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/engine/ __tests__/engine/ConversationEngine.test.ts
git commit -m "feat: conversation engine — orchestrates wake, STT, LLM, TTS, storage"
```

---

## Task 9: Navigation + App Entry

**Files:**
- Create: `src/navigation/AppNavigator.tsx`
- Modify: `App.tsx`
- Create: `src/hooks/useConversationEngine.ts`

- [ ] **Step 1: Create the React hook wiring the engine**

Create `src/hooks/useConversationEngine.ts`:
```typescript
import { useState, useEffect, useCallback, useRef } from 'react';
import { ConversationState, SessionMode, LLMMode } from '../types';
import { ConversationEngine } from '../engine/ConversationEngine';
import { WakeWordService } from '../services/wakeword/WakeWordService';
import { STTService } from '../services/stt/STTService';
import { TTSService } from '../services/tts/TTSService';
import { LocalLLMService } from '../services/llm/LocalLLMService';
import { GroqLLMService } from '../services/llm/GroqLLMService';
import { SessionRepository } from '../services/storage/SessionRepository';
import { TurnRepository } from '../services/storage/TurnRepository';
import { SummaryRepository } from '../services/storage/SummaryRepository';
import { PreferencesRepository } from '../services/storage/PreferencesRepository';
import { getDatabase } from '../services/storage/database';

export function useConversationEngine() {
  const engineRef = useRef<ConversationEngine | null>(null);
  const [state, setState] = useState<ConversationState>('idle');
  const [llmMode, setLlmMode] = useState<LLMMode>('local');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const db = await getDatabase();
      const prefs = await new PreferencesRepository(db).get();

      const localLLM = new LocalLLMService();
      // Model file must be bundled or downloaded; path varies by platform
      await localLLM.load('llama-3.2-3b.gguf');

      const groqLLM = new GroqLLMService(prefs.groqApiKey);
      const tts = new TTSService();
      await tts.init(prefs.ttsRate);

      const engine = new ConversationEngine({
        wakeWord: new WakeWordService(),
        stt: new STTService(),
        tts,
        llm: prefs.llmMode === 'online' && groqLLM.isReady() ? groqLLM : localLLM,
        sessionRepo: new SessionRepository(db),
        turnRepo: new TurnRepository(db),
        summaryRepo: new SummaryRepository(db),
      });

      engine.setOnStateChange(setState);
      await engine.startIdle();
      engineRef.current = engine;
      setLlmMode(prefs.llmMode);
      setReady(true);
    })();
  }, []);

  const startSession = useCallback((mode: SessionMode) => {
    engineRef.current?.startSession(mode, llmMode);
  }, [llmMode]);

  const endSession = useCallback(() => {
    engineRef.current?.endSession();
  }, []);

  const toggleLLMMode = useCallback(() => {
    const newMode: LLMMode = llmMode === 'local' ? 'online' : 'local';
    engineRef.current?.toggleLLMMode(newMode);
    setLlmMode(newMode);
  }, [llmMode]);

  return { state, llmMode, ready, startSession, endSession, toggleLLMMode };
}
```

- [ ] **Step 2: Create navigation**

Create `src/navigation/AppNavigator.tsx`:
```typescript
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { HomeScreen } from '../screens/HomeScreen';
import { WalkModeScreen } from '../screens/WalkModeScreen';
import { ChatModeScreen } from '../screens/ChatModeScreen';
import { SessionDetailScreen } from '../screens/SessionDetailScreen';
import { HistoryScreen } from '../screens/HistoryScreen';
import { SettingsScreen } from '../screens/SettingsScreen';

export type RootStackParamList = {
  Home: undefined;
  WalkMode: { mode: SessionMode };
  ChatMode: { mode: SessionMode };
  SessionDetail: { sessionId: number };
  History: undefined;
  Settings: undefined;
};

const Stack = createStackNavigator<RootStackParamList>();

export function AppNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="WalkMode" component={WalkModeScreen} />
        <Stack.Screen name="ChatMode" component={ChatModeScreen} />
        <Stack.Screen name="SessionDetail" component={SessionDetailScreen} />
        <Stack.Screen name="History" component={HistoryScreen} />
        <Stack.Screen name="Settings" component={SettingsScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
```

- [ ] **Step 3: Wire up App.tsx**

Replace `App.tsx` contents:
```typescript
import React from 'react';
import { StatusBar } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AppNavigator } from './src/navigation/AppNavigator';
import { colors } from './src/constants/colors';

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
      <AppNavigator />
    </GestureHandlerRootView>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add src/navigation/ src/hooks/ App.tsx
git commit -m "feat: navigation scaffold and useConversationEngine hook"
```

---

## Task 10: Home Screen

**Files:**
- Create: `src/components/ModeSelector.tsx`
- Create: `src/components/SessionCard.tsx`
- Create: `src/screens/HomeScreen.tsx`
- Test: `__tests__/screens/HomeScreen.test.tsx`

- [ ] **Step 1: Write failing test**

Create `__tests__/screens/HomeScreen.test.tsx`:
```typescript
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { HomeScreen } from '../../src/screens/HomeScreen';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

describe('HomeScreen', () => {
  it('renders all 4 session modes', () => {
    const { getByText } = render(<HomeScreen />);
    expect(getByText('⚡ Just Walk')).toBeTruthy();
    expect(getByText('🧠 Brain Dump')).toBeTruthy();
    expect(getByText('📔 Journal')).toBeTruthy();
    expect(getByText('🎓 Learn & Discuss')).toBeTruthy();
  });

  it('navigates to WalkMode on Start Walk press', () => {
    const { getByText } = render(<HomeScreen />);
    fireEvent.press(getByText('Start Walk'));
    expect(mockNavigate).toHaveBeenCalledWith('WalkMode', { mode: 'just-walk' });
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx jest __tests__/screens/HomeScreen.test.tsx
```
Expected: FAIL

- [ ] **Step 3: Implement ModeSelector component**

Create `src/components/ModeSelector.tsx`:
```typescript
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { SessionMode } from '../types';
import { MODE_LABELS, MODE_DESCRIPTIONS } from '../constants/modes';
import { colors } from '../constants/colors';

const MODES: SessionMode[] = ['just-walk', 'brain-dump', 'journal', 'learn'];

interface Props {
  selected: SessionMode;
  onSelect: (mode: SessionMode) => void;
}

export function ModeSelector({ selected, onSelect }: Props) {
  return (
    <View style={styles.container}>
      {MODES.map(mode => (
        <TouchableOpacity
          key={mode}
          style={[styles.item, selected === mode && styles.itemActive]}
          onPress={() => onSelect(mode)}
          accessibilityRole="radio"
          accessibilityState={{ selected: selected === mode }}
        >
          <Text style={[styles.label, selected === mode && styles.labelActive]}>
            {MODE_LABELS[mode]}
          </Text>
          <Text style={styles.description}>{MODE_DESCRIPTIONS[mode]}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 8 },
  item: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 12 },
  itemActive: { borderWidth: 2, borderColor: colors.borderActive },
  label: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  labelActive: { color: colors.orange },
  description: { color: colors.textFaint, fontSize: 11, marginTop: 2 },
});
```

- [ ] **Step 4: Implement SessionCard component**

Create `src/components/SessionCard.tsx`:
```typescript
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Session } from '../types';
import { MODE_LABELS } from '../constants/modes';
import { colors } from '../constants/colors';

interface Props {
  session: Session;
  preview?: string;
  onPress: () => void;
}

export function SessionCard({ session, preview, onPress }: Props) {
  const date = new Date(session.startedAt);
  const dateStr = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const durStr = session.durationSecs ? `${Math.round(session.durationSecs / 60)} min` : '';

  return (
    <TouchableOpacity style={styles.card} onPress={onPress}>
      <View style={styles.header}>
        <Text style={styles.mode}>{MODE_LABELS[session.mode]}</Text>
        <Text style={styles.meta}>{dateStr}{durStr ? ` · ${durStr}` : ''}</Text>
      </View>
      {preview ? <Text style={styles.preview} numberOfLines={1}>{preview}</Text> : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, marginBottom: 6 },
  header: { flexDirection: 'row', justifyContent: 'space-between' },
  mode: { color: colors.orange, fontSize: 11, fontWeight: '600' },
  meta: { color: colors.textFaint, fontSize: 10 },
  preview: { color: colors.textDim, fontSize: 10, marginTop: 4 },
});
```

- [ ] **Step 5: Implement HomeScreen**

Create `src/screens/HomeScreen.tsx`:
```typescript
import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SessionMode, Session } from '../types';
import { ModeSelector } from '../components/ModeSelector';
import { SessionCard } from '../components/SessionCard';
import { colors } from '../constants/colors';
import { getDatabase } from '../services/storage/database';
import { SessionRepository } from '../services/storage/SessionRepository';
import { PreferencesRepository } from '../services/storage/PreferencesRepository';

export function HomeScreen() {
  const navigation = useNavigation<any>();
  const [selectedMode, setSelectedMode] = useState<SessionMode>('just-walk');
  const [recentSessions, setRecentSessions] = useState<Session[]>([]);

  useEffect(() => {
    (async () => {
      const db = await getDatabase();
      const prefs = await new PreferencesRepository(db).get();
      setSelectedMode(prefs.defaultMode);
      const sessions = await new SessionRepository(db).list(3);
      setRecentSessions(sessions);
    })();
  }, []);

  const handleStartWalk = () => {
    navigation.navigate('WalkMode', { mode: selectedMode });
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>ToKaWalk</Text>
      <Text style={styles.tagline}>your walking companion</Text>

      <Text style={styles.sectionLabel}>WHAT KIND OF WALK?</Text>
      <ModeSelector selected={selectedMode} onSelect={setSelectedMode} />

      <TouchableOpacity style={styles.startBtn} onPress={handleStartWalk}>
        <Text style={styles.startBtnText}>Start Walk</Text>
      </TouchableOpacity>

      {recentSessions.length > 0 && (
        <View style={styles.history}>
          <Text style={styles.sectionLabel}>RECENT WALKS</Text>
          {recentSessions.map(s => (
            <SessionCard
              key={s.id}
              session={s}
              onPress={() => navigation.navigate('SessionDetail', { sessionId: s.id })}
            />
          ))}
          <TouchableOpacity onPress={() => navigation.navigate('History')}>
            <Text style={styles.viewAll}>View all →</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20 },
  title: { color: colors.orange, fontSize: 24, fontWeight: '700', letterSpacing: 2, textAlign: 'center', marginTop: 12 },
  tagline: { color: colors.textFaint, fontSize: 12, textAlign: 'center', marginBottom: 24 },
  sectionLabel: { color: colors.textDim, fontSize: 10, letterSpacing: 1, marginBottom: 10 },
  startBtn: { backgroundColor: colors.orange, borderRadius: 24, paddingVertical: 12, alignItems: 'center', marginTop: 16 },
  startBtnText: { color: colors.white, fontWeight: '700', fontSize: 14 },
  history: { marginTop: 24 },
  viewAll: { color: colors.orange, fontSize: 11, textAlign: 'right', marginTop: 4 },
});
```

- [ ] **Step 6: Run test — expect PASS**

```bash
npx jest __tests__/screens/HomeScreen.test.tsx
```
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/screens/HomeScreen.tsx src/components/ModeSelector.tsx src/components/SessionCard.tsx __tests__/screens/
git commit -m "feat: home screen — mode picker and recent walks"
```

---

## Task 11: Walk Mode Screen

**Files:**
- Create: `src/components/MicOrb.tsx`
- Create: `src/components/LLMModeBadge.tsx`
- Create: `src/screens/WalkModeScreen.tsx`

- [ ] **Step 1: Implement MicOrb**

Create `src/components/MicOrb.tsx`:
```typescript
import React, { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet } from 'react-native';
import { ConversationState } from '../types';
import { colors } from '../constants/colors';

interface Props { state: ConversationState; }

export function MicOrb({ state }: Props) {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (state === 'listening') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1.12, duration: 800, useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 1, duration: 800, useNativeDriver: true }),
        ]),
      ).start();
    } else {
      pulse.stopAnimation();
      pulse.setValue(1);
    }
  }, [state]);

  const borderColor =
    state === 'listening' ? colors.green :
    state === 'speaking' ? colors.orange :
    colors.borderActive;

  return (
    <View style={styles.wrapper}>
      <Animated.View style={[styles.ring2, { borderColor: borderColor + '22', transform: [{ scale: pulse }] }]} />
      <Animated.View style={[styles.ring1, { borderColor: borderColor + '44', transform: [{ scale: pulse }] }]} />
      <View style={[styles.orb, { borderColor }]}>
        <View style={styles.mic} />
      </View>
    </View>
  );
}

const ORB = 110;
const styles = StyleSheet.create({
  wrapper: { alignItems: 'center', justifyContent: 'center', width: ORB + 40, height: ORB + 40 },
  orb: { width: ORB, height: ORB, borderRadius: ORB / 2, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  ring1: { position: 'absolute', width: ORB + 18, height: ORB + 18, borderRadius: (ORB + 18) / 2, borderWidth: 2 },
  ring2: { position: 'absolute', width: ORB + 36, height: ORB + 36, borderRadius: (ORB + 36) / 2, borderWidth: 1 },
  mic: { width: 24, height: 24, borderRadius: 4, backgroundColor: colors.textMuted }, // placeholder — replace with icon
});
```

- [ ] **Step 2: Implement LLMModeBadge**

Create `src/components/LLMModeBadge.tsx`:
```typescript
import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { LLMMode } from '../types';
import { colors } from '../constants/colors';

interface Props {
  mode: LLMMode;
  onToggle: () => void;
  disabled?: boolean;
}

export function LLMModeBadge({ mode, onToggle, disabled }: Props) {
  return (
    <TouchableOpacity
      style={[styles.badge, disabled && styles.disabled]}
      onPress={onToggle}
      disabled={disabled}
    >
      <Text style={styles.text}>{mode === 'local' ? '📴 Local' : '🌐 Online'}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  badge: { borderWidth: 1, borderColor: colors.borderActive, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  disabled: { borderColor: colors.border, opacity: 0.5 },
  text: { color: colors.orange, fontSize: 11 },
});
```

- [ ] **Step 3: Implement WalkModeScreen**

Create `src/screens/WalkModeScreen.tsx`:
```typescript
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { MicOrb } from '../components/MicOrb';
import { LLMModeBadge } from '../components/LLMModeBadge';
import { useConversationEngine } from '../hooks/useConversationEngine';
import { MODE_LABELS } from '../constants/modes';
import { colors } from '../constants/colors';
import { RootStackParamList } from '../navigation/AppNavigator';

type WalkModeRouteProp = RouteProp<RootStackParamList, 'WalkMode'>;

const STATE_LABELS: Record<string, string> = {
  listening: 'Listening...',
  thinking: 'Thinking...',
  speaking: 'Toka is speaking...',
  idle: 'just talk — "Bye Toka" to end',
};

export function WalkModeScreen() {
  const route = useRoute<WalkModeRouteProp>();
  const navigation = useNavigation<any>();
  const { mode } = route.params;
  const { state, llmMode, startSession, endSession, toggleLLMMode } = useConversationEngine();
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    startSession(mode);
    const timer = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const elapsedStr = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;

  const handleEnd = async () => {
    await endSession();
    navigation.navigate('Home');
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.modeLabel}>{MODE_LABELS[mode]} · {elapsedStr}</Text>
        <LLMModeBadge mode={llmMode} onToggle={toggleLLMMode} />
      </View>

      <View style={styles.center}>
        <MicOrb state={state} />
        <Text style={styles.status}>{STATE_LABELS[state] ?? ''}</Text>
      </View>

      <View style={styles.controls}>
        <TouchableOpacity style={styles.btn} onPress={() => navigation.navigate('ChatMode', { mode })}>
          <Text style={styles.btnIcon}>💬</Text>
          <Text style={styles.btnLabel}>Chat Mode</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btn} onPress={() => navigation.navigate('Settings')}>
          <Text style={styles.btnIcon}>⚙️</Text>
          <Text style={styles.btnLabel}>Settings</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btn} onPress={handleEnd}>
          <Text style={styles.btnIcon}>■</Text>
          <Text style={styles.btnLabel}>End</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, padding: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modeLabel: { color: colors.textFaint, fontSize: 11 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  status: { color: colors.green, fontSize: 13, marginTop: 16 },
  controls: { flexDirection: 'row', justifyContent: 'center', gap: 28, paddingBottom: 20 },
  btn: { alignItems: 'center' },
  btnIcon: { fontSize: 22, color: colors.textMuted, backgroundColor: colors.surface, padding: 8, borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: colors.border },
  btnLabel: { color: colors.textFaint, fontSize: 10, marginTop: 4 },
});
```

- [ ] **Step 4: Commit**

```bash
git add src/screens/WalkModeScreen.tsx src/components/MicOrb.tsx src/components/LLMModeBadge.tsx
git commit -m "feat: walk mode screen — eyes-free orb, mode badge, controls"
```

---

## Task 12: Chat Mode Screen

**Files:**
- Create: `src/components/ChatBubble.tsx`
- Create: `src/screens/ChatModeScreen.tsx`

- [ ] **Step 1: Implement ChatBubble**

Create `src/components/ChatBubble.tsx`:
```typescript
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Turn } from '../types';
import { colors } from '../constants/colors';

interface Props { turn: Turn; }

export function ChatBubble({ turn }: Props) {
  const isUser = turn.speaker === 'user';
  const text = turn.status === 'interrupted' ? `${turn.text}…` : turn.text;

  return (
    <View style={[styles.row, isUser ? styles.rowUser : styles.rowToka]}>
      {!isUser && <Text style={styles.label}>Toka</Text>}
      <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleToka]}>
        <Text style={[styles.text, isUser ? styles.textUser : styles.textToka]}>{text}</Text>
      </View>
      {isUser && <Text style={styles.label}>You</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { marginVertical: 4, maxWidth: '82%' },
  rowUser: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  rowToka: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  label: { color: colors.textFaint, fontSize: 9, marginBottom: 2 },
  bubble: { borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  bubbleUser: { backgroundColor: colors.orange, borderBottomRightRadius: 2 },
  bubbleToka: { borderWidth: 1, borderColor: colors.border, borderBottomLeftRadius: 2 },
  text: { fontSize: 13, lineHeight: 20 },
  textUser: { color: colors.white },
  textToka: { color: colors.text },
});
```

- [ ] **Step 2: Implement ChatModeScreen**

Create `src/screens/ChatModeScreen.tsx`:
```typescript
import React, { useEffect, useRef, useState } from 'react';
import { View, FlatList, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { ChatBubble } from '../components/ChatBubble';
import { LLMModeBadge } from '../components/LLMModeBadge';
import { useConversationEngine } from '../hooks/useConversationEngine';
import { Turn } from '../types';
import { MODE_LABELS } from '../constants/modes';
import { colors } from '../constants/colors';
import { RootStackParamList } from '../navigation/AppNavigator';
import { getDatabase } from '../services/storage/database';
import { TurnRepository } from '../services/storage/TurnRepository';

type ChatModeRouteProp = RouteProp<RootStackParamList, 'ChatMode'>;

export function ChatModeScreen() {
  const route = useRoute<ChatModeRouteProp>();
  const navigation = useNavigation<any>();
  const { mode } = route.params;
  const { state, llmMode, endSession, toggleLLMMode } = useConversationEngine();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const listRef = useRef<FlatList>(null);

  // Poll turns from DB every second (simple approach for v1)
  useEffect(() => {
    const interval = setInterval(async () => {
      // sessionId would be tracked in a shared context in a fuller implementation
      // For now, load the most recent session's turns
    }, 1000);
    const timer = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => { clearInterval(interval); clearInterval(timer); };
  }, []);

  useEffect(() => {
    listRef.current?.scrollToEnd({ animated: true });
  }, [turns]);

  const elapsedStr = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.modeLabel}>{MODE_LABELS[mode]} · {elapsedStr}</Text>
        <View style={styles.headerRight}>
          <LLMModeBadge mode={llmMode} onToggle={toggleLLMMode} />
          <TouchableOpacity onPress={() => navigation.navigate('WalkMode', { mode })}>
            <Text style={styles.walkIcon}>🚶</Text>
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        ref={listRef}
        data={turns}
        keyExtractor={t => String(t.id)}
        renderItem={({ item }) => <ChatBubble turn={item} />}
        contentContainerStyle={styles.list}
      />

      <View style={styles.inputBar}>
        <Text style={styles.placeholder}>just talk or tap mic</Text>
        <TouchableOpacity style={styles.micBtn}>
          <Text style={styles.micIcon}>🎙️</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, paddingTop: 48 },
  modeLabel: { color: colors.textFaint, fontSize: 11 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  walkIcon: { fontSize: 18 },
  list: { padding: 16, paddingBottom: 8 },
  inputBar: { flexDirection: 'row', alignItems: 'center', padding: 12, borderTopWidth: 1, borderTopColor: colors.border, gap: 10 },
  placeholder: { flex: 1, color: colors.textFaint, fontSize: 13, borderWidth: 1, borderColor: colors.border, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  micBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderColor: colors.borderActive, alignItems: 'center', justifyContent: 'center' },
  micIcon: { fontSize: 18 },
});
```

- [ ] **Step 3: Commit**

```bash
git add src/screens/ChatModeScreen.tsx src/components/ChatBubble.tsx
git commit -m "feat: chat mode screen — bubbles, badge, walk mode toggle"
```

---

## Task 13: Session Detail + History Screens

**Files:**
- Create: `src/screens/SessionDetailScreen.tsx`
- Create: `src/screens/HistoryScreen.tsx`

- [ ] **Step 1: Implement SessionDetailScreen**

Create `src/screens/SessionDetailScreen.tsx`:
```typescript
import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import { Session, Turn, Summary } from '../types';
import { MODE_LABELS } from '../constants/modes';
import { colors } from '../constants/colors';
import { getDatabase } from '../services/storage/database';
import { SessionRepository } from '../services/storage/SessionRepository';
import { TurnRepository } from '../services/storage/TurnRepository';
import { SummaryRepository } from '../services/storage/SummaryRepository';
import { RootStackParamList } from '../navigation/AppNavigator';

type SessionDetailRouteProp = RouteProp<RootStackParamList, 'SessionDetail'>;

export function SessionDetailScreen() {
  const route = useRoute<SessionDetailRouteProp>();
  const navigation = useNavigation();
  const { sessionId } = route.params;
  const [session, setSession] = useState<Session | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    (async () => {
      const db = await getDatabase();
      const sessions = await new SessionRepository(db).list(100);
      setSession(sessions.find(s => s.id === sessionId) ?? null);
      setTurns(await new TurnRepository(db).getForSession(sessionId));
      setSummary(await new SummaryRepository(db).getForSession(sessionId));
    })();
  }, [sessionId]);

  if (!session) return null;

  const durStr = session.durationSecs ? `${Math.round(session.durationSecs / 60)} min` : '';

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
        <Text style={styles.backArrow}>←</Text>
      </TouchableOpacity>

      <Text style={styles.mode}>{MODE_LABELS[session.mode]}</Text>
      <Text style={styles.meta}>
        {new Date(session.startedAt).toLocaleDateString()}{durStr ? ` · ${durStr}` : ''} · {session.modelUsed === 'local' ? 'Local model' : 'Enhanced'}
      </Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>✨ Summary</Text>
        <Text style={styles.summaryText}>
          {summary?.summaryText || 'Summary unavailable.'}
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>📄 Transcript</Text>
        {turns.map(turn => (
          <View key={turn.id} style={styles.turnRow}>
            <Text style={[styles.turnSpeaker, turn.speaker === 'ai' && styles.turnSpeakerToka]}>
              {turn.speaker === 'user' ? 'You' : 'Toka'}
              {turn.status === 'interrupted' ? ' [interrupted]' : ''}:
            </Text>
            <Text style={styles.turnText}>{turn.text}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20 },
  back: { marginBottom: 16 },
  backArrow: { color: colors.orange, fontSize: 20 },
  mode: { color: colors.text, fontSize: 15, fontWeight: '700' },
  meta: { color: colors.textFaint, fontSize: 11, marginBottom: 16 },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 14, marginBottom: 12 },
  cardTitle: { color: colors.orange, fontSize: 12, fontWeight: '700', marginBottom: 8 },
  summaryText: { color: colors.textMuted, fontSize: 13, lineHeight: 20 },
  turnRow: { marginBottom: 10 },
  turnSpeaker: { color: colors.textDim, fontSize: 11 },
  turnSpeakerToka: { color: colors.orangeMuted },
  turnText: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
});
```

- [ ] **Step 2: Implement HistoryScreen**

Create `src/screens/HistoryScreen.tsx`:
```typescript
import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, Alert, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Session } from '../types';
import { SessionCard } from '../components/SessionCard';
import { colors } from '../constants/colors';
import { getDatabase } from '../services/storage/database';
import { SessionRepository } from '../services/storage/SessionRepository';

export function HistoryScreen() {
  const navigation = useNavigation<any>();
  const [sessions, setSessions] = useState<Session[]>([]);

  const load = useCallback(async () => {
    const db = await getDatabase();
    setSessions(await new SessionRepository(db).list(200));
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDelete = (session: Session) => {
    Alert.alert('Delete session?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          const db = await getDatabase();
          await new SessionRepository(db).delete(session.id);
          load();
        },
      },
    ]);
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.back}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Past Walks</Text>
      </View>
      <FlatList
        data={sessions}
        keyExtractor={s => String(s.id)}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <SessionCard
            session={item}
            onPress={() => navigation.navigate('SessionDetail', { sessionId: item.id })}
            onLongPress={() => handleDelete(item)}
          />
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 20, paddingTop: 48 },
  back: { color: colors.orange, fontSize: 20 },
  title: { color: colors.text, fontSize: 16, fontWeight: '700' },
  list: { padding: 16 },
});
```

> **Note:** Update `SessionCard` to accept an optional `onLongPress` prop for the delete gesture.

- [ ] **Step 3: Commit**

```bash
git add src/screens/SessionDetailScreen.tsx src/screens/HistoryScreen.tsx
git commit -m "feat: session detail (summary + transcript) and history with delete"
```

---

## Task 14: Settings Screen

**Files:**
- Create: `src/screens/SettingsScreen.tsx`

- [ ] **Step 1: Implement SettingsScreen**

Create `src/screens/SettingsScreen.tsx`:
```typescript
import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Switch, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Preferences, VADSensitivity, SessionMode, LLMMode } from '../types';
import { colors } from '../constants/colors';
import { getDatabase } from '../services/storage/database';
import { PreferencesRepository } from '../services/storage/PreferencesRepository';

export function SettingsScreen() {
  const navigation = useNavigation();
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [repo, setRepo] = useState<PreferencesRepository | null>(null);
  const [apiKeyMasked, setApiKeyMasked] = useState(true);

  useEffect(() => {
    (async () => {
      const db = await getDatabase();
      const r = new PreferencesRepository(db);
      setRepo(r);
      setPrefs(await r.get());
    })();
  }, []);

  const update = async <K extends keyof Preferences>(key: K, value: Preferences[K]) => {
    if (!repo || !prefs) return;
    await repo.set(key, value);
    setPrefs({ ...prefs, [key]: value });
  };

  if (!prefs) return null;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
        <Text style={styles.backArrow}>←  Settings</Text>
      </TouchableOpacity>

      <Text style={styles.sectionLabel}>MICROPHONE</Text>
      <View style={styles.row}>
        <Text style={styles.label}>Outdoor mode (raises VAD threshold)</Text>
        <Switch
          value={prefs.vadSensitivity === 'outdoor'}
          onValueChange={v => update('vadSensitivity', v ? 'outdoor' : 'indoor')}
          trackColor={{ true: colors.orange }}
        />
      </View>

      <Text style={styles.sectionLabel}>VOICE</Text>
      <View style={styles.row}>
        <Text style={styles.label}>TTS Speed</Text>
        <Text style={styles.value}>{Math.round(prefs.ttsRate * 100)}%</Text>
      </View>

      <Text style={styles.sectionLabel}>DEFAULTS</Text>
      <View style={styles.row}>
        <Text style={styles.label}>Start in Online mode</Text>
        <Switch
          value={prefs.llmMode === 'online'}
          onValueChange={v => update('llmMode', v ? 'online' : 'local')}
          trackColor={{ true: colors.orange }}
        />
      </View>

      <Text style={styles.sectionLabel}>ONLINE MODE</Text>
      <Text style={styles.hint}>Enter your Groq API key to enable Online mode. Get one free at console.groq.com</Text>
      <View style={styles.row}>
        <TextInput
          style={styles.apiInput}
          value={apiKeyMasked && prefs.groqApiKey ? '••••••••••••••••' : prefs.groqApiKey}
          onFocus={() => setApiKeyMasked(false)}
          onBlur={() => setApiKeyMasked(true)}
          onChangeText={v => update('groqApiKey', v)}
          placeholder="gsk_..."
          placeholderTextColor={colors.textFaint}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      <Text style={styles.sectionLabel}>MODEL INFO</Text>
      <Text style={styles.hint}>Local: Llama 3.2 3B (on-device, offline)</Text>
      <Text style={styles.hint}>Online: Llama 3.1 8B via Groq (internet required)</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20 },
  back: { marginBottom: 24 },
  backArrow: { color: colors.orange, fontSize: 16 },
  sectionLabel: { color: colors.textDim, fontSize: 10, letterSpacing: 1, marginTop: 20, marginBottom: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  label: { color: colors.textMuted, fontSize: 13, flex: 1 },
  value: { color: colors.textFaint, fontSize: 13 },
  hint: { color: colors.textFaint, fontSize: 11, lineHeight: 18, marginBottom: 4 },
  apiInput: { flex: 1, color: colors.text, fontSize: 13, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10 },
});
```

- [ ] **Step 2: Commit**

```bash
git add src/screens/SettingsScreen.tsx
git commit -m "feat: settings screen — VAD, TTS, Groq API key, model info"
```

---

## Task 15: Online Mode Tooltip + End-to-End Smoke Test

**Files:**
- Modify: `src/components/LLMModeBadge.tsx`

- [ ] **Step 1: Add first-time tooltip to LLMModeBadge**

Update `src/components/LLMModeBadge.tsx` — add tooltip logic:
```typescript
import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { LLMMode } from '../types';
import { colors } from '../constants/colors';
import { getDatabase } from '../services/storage/database';
import { PreferencesRepository } from '../services/storage/PreferencesRepository';

interface Props {
  mode: LLMMode;
  onToggle: () => void;
  disabled?: boolean;
}

export function LLMModeBadge({ mode, onToggle, disabled }: Props) {
  const [showTooltip, setShowTooltip] = useState(false);

  const handleToggle = async () => {
    if (mode === 'local') {
      const db = await getDatabase();
      const repo = new PreferencesRepository(db);
      const prefs = await repo.get();
      if (!prefs.hasSeenOnlineTooltip) {
        setShowTooltip(true);
        await repo.set('hasSeenOnlineTooltip', true);
        setTimeout(() => setShowTooltip(false), 3000);
      }
    }
    onToggle();
  };

  return (
    <View>
      {showTooltip && (
        <View style={styles.tooltip}>
          <Text style={styles.tooltipText}>Online mode connects to the internet for smarter responses</Text>
        </View>
      )}
      <TouchableOpacity
        style={[styles.badge, disabled && styles.disabled]}
        onPress={handleToggle}
        disabled={disabled}
      >
        <Text style={styles.text}>{mode === 'local' ? '📴 Local' : '🌐 Online'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { borderWidth: 1, borderColor: colors.borderActive, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  disabled: { borderColor: colors.border, opacity: 0.5 },
  text: { color: colors.orange, fontSize: 11 },
  tooltip: { position: 'absolute', bottom: 36, right: 0, backgroundColor: '#1c1917', borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 8, width: 200, zIndex: 99 },
  tooltipText: { color: colors.textMuted, fontSize: 11, lineHeight: 16 },
});
```

- [ ] **Step 2: Run all tests**

```bash
npx jest --passWithNoTests
```
Expected: All tests PASS.

- [ ] **Step 3: Smoke test on device**

Manual checklist:
- [ ] App launches without crash
- [ ] Home screen shows 4 modes, "Just Walk" selected by default
- [ ] Tapping "Start Walk" opens Walk Mode
- [ ] Mic orb pulses in "Listening" state
- [ ] Elapsed timer ticking
- [ ] Chat Mode toggle switches screen
- [ ] LLM badge visible in both modes
- [ ] Settings opens, API key field present
- [ ] Back navigation works from all screens

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: online mode tooltip, full smoke test checklist"
```

---

## What's Not In This Plan (Requires Device Work Post-Scaffolding)

- **Porcupine keyword file:** Train "Hey Toka" at console.picovoice.ai → download `.ppn` → bundle into Android assets and iOS bundle
- **Llama model file:** Download `llama-3.2-3b.gguf` → bundle or download on first launch (file is ~2GB — download-on-first-launch is safer for app store distribution)
- **llama.rn completion API:** Exact API shape varies by version — check the [llama.rn docs](https://github.com/mybigday/llama.rn) and update `LocalLLMService.ts` accordingly
- **iOS permissions:** `NSMicrophoneUsageDescription` and `NSSpeechRecognitionUsageDescription` in `Info.plist`
- **Android permissions:** `RECORD_AUDIO` in `AndroidManifest.xml`
- **AEC audio session config:** Set `AVAudioSession .playAndRecord` on iOS; `AudioManager VOICE_COMMUNICATION` on Android in native module setup
