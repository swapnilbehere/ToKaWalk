CREATE TABLE IF NOT EXISTS turns (
    id                 TEXT PRIMARY KEY,
    session_id         TEXT NOT NULL,
    timestamp          INTEGER NOT NULL,
    user_message       TEXT NOT NULL,
    assistant_response TEXT NOT NULL,
    model_used         TEXT NOT NULL,
    latency_ms         REAL NOT NULL,
    input_tokens       INTEGER,
    output_tokens      INTEGER,
    error_type         TEXT,
    retry_count        INTEGER DEFAULT 0,
    routing_reason     TEXT NOT NULL,
    feedback           INTEGER
);

CREATE TABLE IF NOT EXISTS eval_results (
    id              TEXT PRIMARY KEY,
    run_date        INTEGER NOT NULL,
    turn_id         TEXT NOT NULL,
    conciseness     INTEGER,
    helpfulness     INTEGER,
    safety          INTEGER,
    overall         REAL,
    judge_reasoning TEXT
);

CREATE INDEX IF NOT EXISTS idx_turns_session   ON turns(session_id);
CREATE INDEX IF NOT EXISTS idx_turns_timestamp ON turns(timestamp);
CREATE INDEX IF NOT EXISTS idx_eval_run        ON eval_results(run_date);
