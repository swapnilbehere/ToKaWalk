import { SessionRepository } from '../../src/services/storage/SessionRepository';

const mockDb = {
  executeSql: jest.fn(),
  transaction: jest.fn((cb: Function) => cb({ executeSql: jest.fn() })),
};

describe('SessionRepository', () => {
  beforeEach(() => jest.clearAllMocks());

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
