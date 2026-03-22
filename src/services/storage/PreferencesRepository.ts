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
