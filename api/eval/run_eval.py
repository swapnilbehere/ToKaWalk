"""
Score unscored production turns with LLM-as-judge and store results.

Run from the api/ directory:
    python -m eval.run_eval
    python -m eval.run_eval --n 100

To run against a locally downloaded DB (from Railway volume):
    DB_PATH=/path/to/tokawalk.db python -m eval.run_eval
"""
import argparse
import os
import sqlite3
import time
import uuid

from dotenv import load_dotenv

load_dotenv()

from eval.judge import judge_turn

DB_PATH = os.getenv("DB_PATH", "tokawalk.db")


def sample_unscored_turns(n: int) -> list[dict]:
    db = sqlite3.connect(DB_PATH)
    rows = db.execute(
        """SELECT t.id, t.user_message, t.assistant_response
           FROM turns t
           LEFT JOIN eval_results e ON e.turn_id = t.id
           WHERE e.turn_id IS NULL
             AND t.assistant_response != ''
             AND t.error_type IS NULL
           ORDER BY RANDOM()
           LIMIT ?""",
        (n,),
    ).fetchall()
    db.close()
    return [{"id": r[0], "user": r[1], "assistant": r[2]} for r in rows]


def store_result(turn_id: str, scores: dict) -> None:
    overall = (scores["conciseness"] + scores["helpfulness"] + scores["safety"]) / 3
    db = sqlite3.connect(DB_PATH)
    db.execute(
        "INSERT INTO eval_results VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (
            str(uuid.uuid4()),
            int(time.time() * 1000),
            turn_id,
            scores["conciseness"],
            scores["helpfulness"],
            scores["safety"],
            round(overall, 2),
            scores.get("reasoning", ""),
        ),
    )
    db.commit()
    db.close()


def run(n: int = 50) -> None:
    turns = sample_unscored_turns(n)
    if not turns:
        print("No unscored turns found. Use the app or web demo to generate conversations first.")
        return

    print(f"Evaluating {len(turns)} turns...")
    batch_scores = []

    for t in turns:
        scores = judge_turn(t["user"], t["assistant"])
        store_result(t["id"], scores)
        overall = (scores["conciseness"] + scores["helpfulness"] + scores["safety"]) / 3
        batch_scores.append(overall)
        print(
            f"  {t['id'][:8]}… "
            f"C={scores['conciseness']} H={scores['helpfulness']} S={scores['safety']} "
            f"→ {overall:.2f}"
        )

    print(
        f"\nBatch: avg={sum(batch_scores)/len(batch_scores):.2f} "
        f"min={min(batch_scores):.2f} "
        f"max={max(batch_scores):.2f}"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--n", type=int, default=50, help="Number of turns to evaluate")
    args = parser.parse_args()
    run(args.n)
