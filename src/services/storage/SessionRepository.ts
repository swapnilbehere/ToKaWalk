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
