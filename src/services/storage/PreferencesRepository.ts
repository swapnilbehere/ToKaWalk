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

export class PreferencesRepository {
  constructor(private db: DB) {}

  async get(): Promise<SQLitePreferences & { groqApiKey: string }> {
    const result = await this.db.execute('SELECT key, value FROM preferences');
    const map: Record<string, string> = {};
    for (const row of result.rows) {
      map[row.key as string] = row.value as string;
    }
    return {
      vadSensitivity: (map.vadSensitivity as VADSensitivity) ?? DEFAULTS.vadSensitivity,
      defaultMode: (map.defaultMode as SessionMode) ?? DEFAULTS.defaultMode,
      llmMode: (map.llmMode as LLMMode) ?? DEFAULTS.llmMode,
      ttsRate: map.ttsRate ? parseFloat(map.ttsRate) : DEFAULTS.ttsRate,
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
