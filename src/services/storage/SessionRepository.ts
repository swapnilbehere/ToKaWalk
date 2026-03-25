import { DB } from '@op-engineering/op-sqlite';
import { Session, SessionMode, LLMMode } from '../../types';

export class SessionRepository {
  constructor(private db: DB) {}

  async create(params: { mode: SessionMode; startedAt: number; modelUsed: LLMMode }): Promise<number> {
    const result = await this.db.execute(
      'INSERT INTO sessions (mode, started_at, model_used) VALUES (?, ?, ?)',
      [params.mode, params.startedAt, params.modelUsed],
    );
    return result.insertId!;
  }

  async end(id: number, endedAt: number): Promise<void> {
    const durationSecs = Math.round((endedAt - (await this.getStartedAt(id))) / 1000);
    await this.db.execute(
      'UPDATE sessions SET ended_at = ?, duration_secs = ? WHERE id = ?',
      [endedAt, durationSecs, id],
    );
  }

  async list(limit: number): Promise<Session[]> {
    const result = await this.db.execute(
      'SELECT * FROM sessions ORDER BY started_at DESC LIMIT ?',
      [limit],
    );
    return result.rows.map(rowToSession);
  }

  async delete(id: number): Promise<void> {
    await this.db.execute('DELETE FROM sessions WHERE id = ?', [id]);
  }

  private async getStartedAt(id: number): Promise<number> {
    const result = await this.db.execute('SELECT started_at FROM sessions WHERE id = ?', [id]);
    return result.rows[0].started_at as number;
  }
}

function rowToSession(row: Record<string, any>): Session {
  return {
    id: row.id,
    mode: row.mode,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationSecs: row.duration_secs,
    modelUsed: row.model_used,
  };
}
