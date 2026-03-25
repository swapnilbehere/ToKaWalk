import { DB } from '@op-engineering/op-sqlite';
import { Turn, SpeakerRole, TurnStatus } from '../../types';

export class TurnRepository {
  constructor(private db: DB) {}

  async add(params: {
    sessionId: number;
    speaker: SpeakerRole;
    text: string;
    status?: TurnStatus;
  }): Promise<number> {
    const result = await this.db.execute(
      'INSERT INTO turns (session_id, speaker, text, timestamp, status) VALUES (?, ?, ?, ?, ?)',
      [params.sessionId, params.speaker, params.text, Date.now(), params.status ?? 'completed'],
    );
    return result.insertId!;
  }

  async getForSession(sessionId: number): Promise<Turn[]> {
    const result = await this.db.execute(
      'SELECT * FROM turns WHERE session_id = ? ORDER BY timestamp ASC',
      [sessionId],
    );
    return result.rows.map(rowToTurn);
  }
}

function rowToTurn(row: Record<string, any>): Turn {
  return {
    id: row.id,
    sessionId: row.session_id,
    speaker: row.speaker,
    text: row.text,
    timestamp: row.timestamp,
    status: row.status,
  };
}
