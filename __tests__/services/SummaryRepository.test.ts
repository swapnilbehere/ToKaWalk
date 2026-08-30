import { SummaryRepository } from '../../src/services/storage/SummaryRepository';

function makeDb() {
  const store: any[] = [];
  return {
    store,
    db: {
      execute: jest.fn(async (sql: string, params: any[]) => {
        if (sql.startsWith('INSERT OR REPLACE INTO summaries')) {
          const [session_id, summary_text, generated_at] = params;
          const idx = store.findIndex((r) => r.session_id === session_id);
          const row = { id: idx >= 0 ? store[idx].id : store.length + 1, session_id, summary_text, generated_at };
          if (idx >= 0) store[idx] = row; else store.push(row);
          return { rows: [] };
        }
        if (sql.startsWith('SELECT')) {
          const [session_id] = params;
          return { rows: store.filter((r) => r.session_id === session_id) };
        }
        return { rows: [] };
      }),
    } as any,
  };
}

describe('SummaryRepository', () => {
  it('returns null for a session with no summary', async () => {
    const { db } = makeDb();
    expect(await new SummaryRepository(db).getForSession(42)).toBeNull();
  });

  it('saves and reads back a summary', async () => {
    const { db } = makeDb();
    const repo = new SummaryRepository(db);
    await repo.save(7, 'Talked about the weather and a work deadline.');
    const got = await repo.getForSession(7);
    expect(got).toMatchObject({ sessionId: 7, summaryText: 'Talked about the weather and a work deadline.' });
    expect(typeof got!.generatedAt).toBe('number');
  });

  it('overwrites an existing summary for the same session (INSERT OR REPLACE)', async () => {
    const { db, store } = makeDb();
    const repo = new SummaryRepository(db);
    await repo.save(1, 'first');
    await repo.save(1, 'second');
    expect(store.filter((r) => r.session_id === 1)).toHaveLength(1);
    expect((await repo.getForSession(1))!.summaryText).toBe('second');
  });

  it('persists very long summary text without truncation at the repo layer', async () => {
    const { db } = makeDb();
    const repo = new SummaryRepository(db);
    const long = 'x'.repeat(20_000);
    await repo.save(3, long);
    expect((await repo.getForSession(3))!.summaryText).toHaveLength(20_000);
  });
});
