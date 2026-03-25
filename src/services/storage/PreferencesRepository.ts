import { DB } from '@op-engineering/op-sqlite';
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
  constructor(private db: DB) {}

  async get(): Promise<Preferences> {
    const result = await this.db.execute('SELECT key, value FROM preferences');
    const map: Record<string, string> = {};
    for (const row of result.rows) {
      map[row.key as string] = row.value as string;
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
    await this.db.execute(
      'INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)',
      [key, String(value)],
    );
  }
}
