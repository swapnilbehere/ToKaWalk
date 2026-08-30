import { PreferencesRepository } from '../../src/services/storage/PreferencesRepository';

function dbReturning(rows: Array<{ key: string; value: string }>) {
  return {
    execute: jest.fn(async (sql: string) => {
      if (sql.startsWith('SELECT')) return { rows };
      return { rows: [], rowsAffected: 1 };
    }),
  } as any;
}

describe('PreferencesRepository.get — defaults & validation', () => {
  it('returns defaults when the table is empty', async () => {
    const repo = new PreferencesRepository(dbReturning([]));
    const prefs = await repo.get();
    expect(prefs).toMatchObject({
      vadSensitivity: 'indoor',
      defaultMode: 'just-walk',
      llmMode: 'local',
      ttsRate: 0.5,
      hasSeenOnlineTooltip: false,
      groqApiKey: '',
    });
  });

  it('falls back to defaults for corrupt enum values', async () => {
    const repo = new PreferencesRepository(
      dbReturning([
        { key: 'vadSensitivity', value: 'DEAFENING' },
        { key: 'defaultMode', value: 'time-travel' },
        { key: 'llmMode', value: 'quantum' },
      ]),
    );
    const prefs = await repo.get();
    expect(prefs.vadSensitivity).toBe('indoor');
    expect(prefs.defaultMode).toBe('just-walk');
    expect(prefs.llmMode).toBe('local');
  });

  it('never returns NaN ttsRate and clamps out-of-range values', async () => {
    const cases: Array<[string, number]> = [
      ['abc', 0.5],
      ['', 0.5],
      ['-5', 0.1],
      ['999', 2.0],
      ['1.25', 1.25],
      ['0', 0.1],
    ];
    for (const [stored, expected] of cases) {
      const repo = new PreferencesRepository(dbReturning([{ key: 'ttsRate', value: stored }]));
      const prefs = await repo.get();
      expect(prefs.ttsRate).toBeCloseTo(expected, 5);
      expect(Number.isNaN(prefs.ttsRate)).toBe(false);
    }
  });

  it('parses hasSeenOnlineTooltip strictly from the string "true"', async () => {
    for (const [stored, expected] of [['true', true], ['1', false], ['yes', false], ['TRUE', false]] as const) {
      const repo = new PreferencesRepository(dbReturning([{ key: 'hasSeenOnlineTooltip', value: stored }]));
      expect((await repo.get()).hasSeenOnlineTooltip).toBe(expected);
    }
  });

  it('accepts valid non-default values unchanged', async () => {
    const repo = new PreferencesRepository(
      dbReturning([
        { key: 'vadSensitivity', value: 'outdoor' },
        { key: 'defaultMode', value: 'journal' },
        { key: 'llmMode', value: 'online' },
      ]),
    );
    const prefs = await repo.get();
    expect(prefs).toMatchObject({ vadSensitivity: 'outdoor', defaultMode: 'journal', llmMode: 'online' });
  });
});

describe('PreferencesRepository.set', () => {
  it('stringifies the value and uses INSERT OR REPLACE', async () => {
    const db = dbReturning([]);
    const repo = new PreferencesRepository(db);
    await repo.set('ttsRate', 0.8);
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT OR REPLACE'),
      ['ttsRate', '0.8'],
    );
  });
});
