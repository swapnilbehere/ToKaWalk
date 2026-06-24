"""
Generate synthetic fine-tuning data from top-rated production turns.

Steps:
1. Run eval.run_eval to score production turns first
2. Run this script from the finetune/ directory:
       GROQ_API_KEY=<key> DB_PATH=../api/tokawalk.db python generate_data.py
3. Output: training_data.jsonl (upload this to Colab before training)
"""
import json
import os
import sqlite3
import sys

from dotenv import load_dotenv

load_dotenv()

# Allow importing from api/ if running from repo root
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "api"))

from groq import Groq

client = Groq(api_key=os.environ["GROQ_API_KEY"])
DB_PATH = os.getenv("DB_PATH", os.path.join(os.path.dirname(__file__), "..", "api", "tokawalk.db"))

NOVA_FINETUNE_SYSTEM = (
    "You are Nova, a concise and friendly AI walking companion. "
    "Keep responses under 2 sentences. Never reference visual elements."
)


def get_top_turns(n: int = 50) -> list[dict]:
    db = sqlite3.connect(DB_PATH)
    rows = db.execute(
        """SELECT t.user_message, t.assistant_response, e.overall
           FROM turns t
           JOIN eval_results e ON e.turn_id = t.id
           WHERE e.overall >= 4.0
           ORDER BY e.overall DESC
           LIMIT ?""",
        (n,),
    ).fetchall()
    db.close()
    return [{"user": r[0], "assistant": r[1], "score": r[2]} for r in rows]


def generate_variations(turn: dict, n: int = 4) -> list[dict]:
    prompt = f"""Given this example of a good walking companion interaction:
User: {turn['user']}
Nova: {turn['assistant']}

Generate {n} similar but different conversations that maintain the same quality:
- Concise responses (1-2 sentences max)
- Conversational and warm tone
- No visual references ("as you can see", "look at this")
- Appropriate for someone walking outdoors

Return a JSON array only, no other text: [{{"user": "...", "assistant": "..."}}]"""

    resp = client.chat.completions.create(
        model="llama-3.1-8b-instant",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.8,
        max_tokens=1000,
    )
    try:
        content = resp.choices[0].message.content.strip()
        # Strip markdown code fences if present
        if content.startswith("```"):
            content = content.split("```")[1]
            if content.startswith("json"):
                content = content[4:]
        return json.loads(content)
    except Exception as e:
        print(f"  Warning: variation parse failed ({e}), skipping")
        return []


def build_dataset(output_path: str = "training_data.jsonl") -> None:
    seeds = get_top_turns(50)
    if not seeds:
        print("No high-scoring turns found (score >= 4.0). Run eval.run_eval first.")
        return

    print(f"Found {len(seeds)} seed turns with score >= 4.0")
    all_examples: list[dict] = []

    for i, seed in enumerate(seeds):
        all_examples.append({"user": seed["user"], "assistant": seed["assistant"]})
        print(f"  [{i+1}/{len(seeds)}] Generating variations for: {seed['user'][:60]}…")
        variations = generate_variations(seed, n=4)
        all_examples.extend(variations)

    # Format as ChatML for Qwen fine-tuning
    with open(output_path, "w") as f:
        for ex in all_examples:
            if not ex.get("user") or not ex.get("assistant"):
                continue
            record = {
                "messages": [
                    {"role": "system", "content": NOVA_FINETUNE_SYSTEM},
                    {"role": "user", "content": ex["user"]},
                    {"role": "assistant", "content": ex["assistant"]},
                ]
            }
            f.write(json.dumps(record) + "\n")

    print(f"\nWrote {len(all_examples)} examples to {output_path}")
    print("Next: upload training_data.jsonl to Google Colab and run train.py")


if __name__ == "__main__":
    build_dataset()
