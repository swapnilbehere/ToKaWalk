import { DB } from '@op-engineering/op-sqlite';
import { Preferences, VADSensitivity, SessionMode, LLMMode } from '../../types';

// groqApiKey is intentionally absent — it lives in the system Keychain via SecureStorage.
type SQLitePreferences = Omit<Preferences, 'groqApiKey'>;

const DEFAULTS: SQLitePreferences = {
  vadSensitivity: 'indoor',
  defaultMode: 'just-walk',
  llmMode: 'local',
  ttsRate: 0.5,
  hasSeenOnlineTooltip: false,
};

const VALID_VAD: VADSensitivity[] = ['indoor', 'outdoor'];
const VALID_MODE: SessionMode[] = ['just-walk', 'brain-dump', 'journal', 'learn'];
const VALID_LLM: LLMMode[] = ['local', 'online'];

const TTS_RATE_MIN = 0.1;
const TTS_RATE_MAX = 2.0;

function oneOf<T extends string>(value: string | undefined, allowed: T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function parseRate(value: string | undefined): number {
  if (value === undefined) return DEFAULTS.ttsRate;
  const n = parseFloat(value);
  if (!Number.isFinite(n)) return DEFAULTS.ttsRate;
  return Math.min(TTS_RATE_MAX, Math.max(TTS_RATE_MIN, n));
}

export class PreferencesRepository {
  constructor(private db: DB) {}

  async get(): Promise<SQLitePreferences & { groqApiKey: string }> {
    const result = await this.db.execute('SELECT key, value FROM preferences');
    const map: Record<string, string> = {};
    for (const row of result.rows) {
      map[row.key as string] = row.value as string;
    }
    return {
      vadSensitivity: oneOf(map.vadSensitivity, VALID_VAD, DEFAULTS.vadSensitivity),
      defaultMode: oneOf(map.defaultMode, VALID_MODE, DEFAULTS.defaultMode),
      llmMode: oneOf(map.llmMode, VALID_LLM, DEFAULTS.llmMode),
      ttsRate: parseRate(map.ttsRate),
      hasSeenOnlineTooltip: map.hasSeenOnlineTooltip === 'true',
      // Always empty — real value is loaded from Keychain by SecureStorage.
      groqApiKey: '',
    };
  }

  async set<K extends keyof SQLitePreferences>(key: K, value: SQLitePreferences[K]): Promise<void> {
    await this.db.execute(
      'INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)',
      [key, String(value)],
    );
  }

  // Removes any legacy groqApiKey row that may have been stored in plaintext.
  async clearLegacyApiKey(): Promise<void> {
    await this.db.execute("DELETE FROM preferences WHERE key = 'groqApiKey'");
  }
}
