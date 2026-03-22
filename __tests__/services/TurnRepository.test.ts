import { TurnRepository } from '../../src/services/storage/TurnRepository';

const mockDb = {
  executeSql: jest.fn(),
};

describe('TurnRepository', () => {
  beforeEach(() => jest.clearAllMocks());

  it('adds a turn and returns its id', async () => {
    mockDb.executeSql.mockResolvedValueOnce([{ insertId: 7 }]);
    const repo = new TurnRepository(mockDb as any);
    const id = await repo.add({ sessionId: 1, speaker: 'user', text: 'hello' });
    expect(id).toBe(7);
  });

  it('gets turns for a session ordered by timestamp', async () => {
    const rows = [
      { id: 1, session_id: 1, speaker: 'user', text: 'hi', timestamp: 1000, status: 'completed' },
      { id: 2, session_id: 1, speaker: 'ai', text: 'hello', timestamp: 1001, status: 'completed' },
    ];
    mockDb.executeSql.mockResolvedValueOnce([{ rows: { length: 2, item: (i: number) => rows[i] } }]);
    const repo = new TurnRepository(mockDb as any);
    const turns = await repo.getForSession(1);
    expect(turns).toHaveLength(2);
    expect(turns[0].speaker).toBe('user');
  });

  it('stores interrupted status', async () => {
    mockDb.executeSql.mockResolvedValueOnce([{ insertId: 3 }]);
    const repo = new TurnRepository(mockDb as any);
    await repo.add({ sessionId: 1, speaker: 'ai', text: 'partial', status: 'interrupted' });
    expect(mockDb.executeSql).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(['interrupted']),
    );
  });
});
