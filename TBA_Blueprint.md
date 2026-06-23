# ToKaWalk — Applied AI Engineering Blueprint

This document is the complete build plan to transform ToKaWalk from a well-engineered
mobile app into a production AI system that demonstrates Applied AI Engineering at a
hiring-manager level. Build phases in order. Do not skip Phase 1 — deployment is the
foundation everything else depends on.

---

## Context: Why This Blueprint Exists

ToKaWalk already has real engineering depth:
- `ConversationEngine` is a proper state machine with generation token cancellation
- LLM error classifier distinguishes auth / rate-limit / network errors with different
  retry strategies
- `ContextManager` prunes by both turn count AND token budget simultaneously
- STT has 3 distinct failure modes with different restart delays per type
- 26 tests with full mocks for every external dependency

The problem: none of this is visible to a hiring manager because it only runs as an
APK on one device. There is no deployed URL, no user telemetry, no eval pipeline,
no observable system.

This blueprint adds exactly that. After all four phases, ToKaWalk is a portfolio
project that covers every item on the 2026 Applied AI Engineer hiring checklist.

---

## Target Architecture (end state)

```
ToKaWalk/
├── android/               # existing React Native app (unchanged)
├── src/                   # existing RN source (unchanged)
├── api/                   # NEW: FastAPI backend
│   ├── main.py
│   ├── routers/
│   │   ├── chat.py        # POST /api/chat
│   │   ├── feedback.py    # POST /api/feedback
│   │   └── stats.py       # GET /api/stats
│   ├── services/
│   │   ├── llm_router.py  # QueryClassifier + routing logic
│   │   ├── groq_client.py # Groq SSE streaming wrapper
│   │   └── logger.py      # structured DB logging
│   ├── eval/
│   │   ├── run_eval.py    # weekly eval batch script
│   │   ├── judge.py       # LLM-as-judge scorer
│   │   └── report.py      # EvalReport dataclass + storage
│   ├── db/
│   │   ├── schema.sql     # SQLite schema for logs + eval results
│   │   └── database.py    # DB connection + query helpers
│   ├── models.py          # Pydantic request/response schemas
│   ├── requirements.txt
│   └── railway.toml       # Railway deployment config
├── web/                   # NEW: minimal web demo
│   ├── index.html
│   ├── app.js             # fetch-based chat client, SSE reader
│   └── style.css
├── finetune/              # NEW: QLoRA fine-tuning pipeline
│   ├── generate_data.py   # synthetic data generator from logs
│   ├── train.py           # QLoRA fine-tune script (HuggingFace + peft)
│   ├── eval_model.py      # compare base vs fine-tuned on eval set
│   └── README.md          # documents the fine-tuning run
└── TBA_Blueprint.md       # this file
```

---

## Phase 1 — Deploy It (Days 1–3)

**Goal:** A live URL exists. Anyone can open a browser and talk to ToKaWalk.

### 1.1 FastAPI Backend

Create `api/main.py`:

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import chat, feedback, stats

app = FastAPI(title="ToKaWalk API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten after deploy
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(chat.router, prefix="/api")
app.include_router(feedback.router, prefix="/api")
app.include_router(stats.router, prefix="/api")

@app.get("/health")
def health():
    return {"status": "ok"}
```

Create `api/models.py` (Pydantic schemas):

```python
from pydantic import BaseModel
from typing import Optional, Literal

class ChatRequest(BaseModel):
    message: str
    session_id: str
    history: list[dict] = []          # [{role, content}]
    network_latency_ms: float = 0.0   # client sends this; used for routing

class ChatResponse(BaseModel):
    text: str
    model_used: str
    latency_ms: float
    routing_reason: str

class FeedbackRequest(BaseModel):
    session_id: str
    turn_id: str
    rating: Literal[1, -1]

class StatsResponse(BaseModel):
    total_sessions: int
    total_turns: int
    online_pct: float
    local_pct: float
    p50_latency_ms: float
    p95_latency_ms: float
    error_rate: float
    daily_sessions: list[dict]         # [{date, count}]
```

Create `api/routers/chat.py`:

```python
import time, uuid
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from models import ChatRequest
from services.llm_router import LLMRouter
from services.logger import log_turn

router = APIRouter()
llm_router = LLMRouter()

@router.post("/chat")
async def chat(req: ChatRequest):
    turn_id = str(uuid.uuid4())
    start = time.time()

    decision = llm_router.route(req.message, req.network_latency_ms)

    async def stream():
        full_response = ""
        async for token in llm_router.stream(decision, req.message, req.history):
            full_response += token
            yield f"data: {token}\n\n"
        latency_ms = (time.time() - start) * 1000
        log_turn(
            turn_id=turn_id,
            session_id=req.session_id,
            user_message=req.message,
            assistant_response=full_response,
            model_used=decision.model,
            latency_ms=latency_ms,
            routing_reason=decision.reason,
        )
        yield f"data: [DONE]\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream")
```

### 1.2 Railway Deployment

Create `api/railway.toml`:

```toml
[build]
builder = "nixpacks"

[deploy]
startCommand = "uvicorn main:app --host 0.0.0.0 --port $PORT"
restartPolicyType = "on_failure"
```

Create `api/requirements.txt`:

```
fastapi>=0.111.0
uvicorn[standard]>=0.29.0
groq>=0.9.0
pydantic>=2.0.0
aiosqlite>=0.20.0
httpx>=0.27.0
python-dotenv>=1.0.0
```

Deploy steps:
1. Push `api/` to GitHub (same repo, Railway detects subdirectory)
2. Go to railway.app → New Project → Deploy from GitHub → set root directory to `api/`
3. Add env var: `GROQ_API_KEY=<your key>`
4. Done. Railway gives you a URL like `tokawalk-api.up.railway.app`

### 1.3 Web Demo

Create `web/index.html` — a single-page chat UI that:
- Has a text input and send button
- Connects to `POST /api/chat` and reads the SSE stream
- Shows messages as chat bubbles
- Shows which model was used per response (tiny badge)
- Has a "mic" button placeholder (voice not required in web demo)

The web demo does NOT need to be a full port of the mobile app. Its only job is to let
someone experience the product without installing an APK. Keep it under 200 lines.

Deploy the web demo by dropping it into Railway as a static site, or use Vercel/Netlify
(drag and drop the `web/` folder — free tier, 30 seconds).

**Phase 1 done when:** There is a URL. Opening it in a browser works. You can have a
conversation with Nova without building anything.

---

## Phase 2 — Instrument Everything (Days 4–7)

**Goal:** Every LLM call is logged with structured data. A stats endpoint returns real
numbers. Users can leave feedback.

### 2.1 Database Schema

Create `api/db/schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS turns (
    id              TEXT PRIMARY KEY,
    session_id      TEXT NOT NULL,
    timestamp       INTEGER NOT NULL,       -- unix ms
    user_message    TEXT NOT NULL,
    assistant_response TEXT NOT NULL,
    model_used      TEXT NOT NULL,          -- "groq/llama-3.1-8b" | "local/qwen-2.5-1.5b"
    latency_ms      REAL NOT NULL,
    input_tokens    INTEGER,
    output_tokens   INTEGER,
    error_type      TEXT,                   -- NULL | "rate_limit" | "network" | "auth"
    retry_count     INTEGER DEFAULT 0,
    routing_reason  TEXT NOT NULL,
    feedback        INTEGER                 -- NULL | 1 | -1
);

CREATE TABLE IF NOT EXISTS eval_results (
    id              TEXT PRIMARY KEY,
    run_date        INTEGER NOT NULL,       -- unix ms
    turn_id         TEXT NOT NULL,
    conciseness     INTEGER,                -- 1-5
    helpfulness     INTEGER,               -- 1-5
    safety          INTEGER,               -- 1-5
    overall         REAL,                  -- avg of above
    judge_reasoning TEXT
);

CREATE INDEX IF NOT EXISTS idx_turns_session ON turns(session_id);
CREATE INDEX IF NOT EXISTS idx_turns_timestamp ON turns(timestamp);
CREATE INDEX IF NOT EXISTS idx_eval_run ON eval_results(run_date);
```

Create `api/db/database.py`:

```python
import aiosqlite, os

DB_PATH = os.getenv("DB_PATH", "tokawalk.db")

async def get_db():
    return await aiosqlite.connect(DB_PATH)

async def init_db():
    async with aiosqlite.connect(DB_PATH) as db:
        with open("db/schema.sql") as f:
            await db.executescript(f.read())
        await db.commit()
```

Call `init_db()` in `main.py` on startup via `@app.on_event("startup")`.

### 2.2 Structured Logger

Create `api/services/logger.py`:

```python
import asyncio, time, uuid
from db.database import get_db

def log_turn(
    turn_id: str,
    session_id: str,
    user_message: str,
    assistant_response: str,
    model_used: str,
    latency_ms: float,
    routing_reason: str,
    input_tokens: int = None,
    output_tokens: int = None,
    error_type: str = None,
    retry_count: int = 0,
):
    # fire-and-forget so it doesn't block the response stream
    asyncio.create_task(_write_turn(
        turn_id, session_id, user_message, assistant_response,
        model_used, latency_ms, routing_reason,
        input_tokens, output_tokens, error_type, retry_count
    ))

async def _write_turn(**kwargs):
    async with await get_db() as db:
        await db.execute(
            """INSERT INTO turns VALUES
               (?,?,?,?,?,?,?,?,?,?,?,NULL)""",
            (
                kwargs["turn_id"],
                kwargs["session_id"],
                int(time.time() * 1000),
                kwargs["user_message"],
                kwargs["assistant_response"],
                kwargs["model_used"],
                kwargs["latency_ms"],
                kwargs.get("input_tokens"),
                kwargs.get("output_tokens"),
                kwargs.get("error_type"),
                kwargs.get("retry_count", 0),
                kwargs["routing_reason"],
            )
        )
        await db.commit()
```

### 2.3 Stats Endpoint

Create `api/routers/stats.py`:

```python
from fastapi import APIRouter
from db.database import get_db
import time

router = APIRouter()

@router.get("/stats")
async def stats():
    async with await get_db() as db:
        # total counts
        row = await db.execute_fetchall("SELECT COUNT(DISTINCT session_id), COUNT(*) FROM turns")
        total_sessions, total_turns = row[0]

        # model split
        online = await db.execute_fetchall(
            "SELECT COUNT(*) FROM turns WHERE model_used LIKE 'groq%'")
        local = await db.execute_fetchall(
            "SELECT COUNT(*) FROM turns WHERE model_used LIKE 'local%'")

        # latency percentiles (SQLite doesn't have PERCENTILE_CONT, compute in Python)
        latencies = [r[0] for r in await db.execute_fetchall(
            "SELECT latency_ms FROM turns ORDER BY latency_ms")]

        # daily sessions (last 30 days)
        cutoff = int((time.time() - 30 * 86400) * 1000)
        daily = await db.execute_fetchall(
            """SELECT date(timestamp/1000, 'unixepoch') as d, COUNT(DISTINCT session_id)
               FROM turns WHERE timestamp > ? GROUP BY d ORDER BY d""", (cutoff,))

    p50 = latencies[len(latencies)//2] if latencies else 0
    p95 = latencies[int(len(latencies)*0.95)] if latencies else 0
    online_count = online[0][0]
    total = total_turns or 1

    return {
        "total_sessions": total_sessions,
        "total_turns": total_turns,
        "online_pct": round(online_count / total * 100, 1),
        "local_pct": round((total_turns - online_count) / total * 100, 1),
        "p50_latency_ms": round(p50, 1),
        "p95_latency_ms": round(p95, 1),
        "daily_sessions": [{"date": r[0], "count": r[1]} for r in daily],
    }
```

### 2.4 Feedback Endpoint

Create `api/routers/feedback.py`:

```python
from fastapi import APIRouter
from models import FeedbackRequest
from db.database import get_db

router = APIRouter()

@router.post("/feedback")
async def feedback(req: FeedbackRequest):
    async with await get_db() as db:
        await db.execute(
            "UPDATE turns SET feedback=? WHERE id=?",
            (req.rating, req.turn_id)
        )
        await db.commit()
    return {"status": "ok"}
```

Add thumbs up/down buttons to the web UI that POST to this endpoint with the turn_id
returned from the chat stream's final `[DONE]` event. Modify the stream to emit the
turn_id as part of the DONE payload: `data: [DONE] {"turn_id": "..."}`.

**Phase 2 done when:** Every conversation is in the database. `/api/stats` returns real
numbers with latency percentiles and model split.

---

## Phase 3 — Intelligent Model Routing (Days 8–12)

**Goal:** The system decides which model to use automatically. The decision is logged
and explainable.

### 3.1 QueryClassifier

Create `api/services/llm_router.py`:

```python
from dataclasses import dataclass
from typing import AsyncIterator, Literal
import os, httpx
from groq import AsyncGroq

@dataclass
class RoutingDecision:
    model: Literal["groq", "local"]
    reason: str
    model_id: str

GROQ_MODEL = "llama-3.1-8b-instant"
LOCAL_MODEL = "qwen-2.5-1.5b"

FACTUAL_SIGNALS = [
    "what is", "who is", "when did", "how many", "where is",
    "what are", "define ", "explain ", "tell me about",
    "what does", "how does", "why does",
]

SIMPLE_SIGNALS = [
    "thanks", "thank you", "ok", "okay", "got it", "sure",
    "yes", "no", "bye", "goodbye", "hello", "hi",
]

class LLMRouter:
    def __init__(self):
        self.groq_client = AsyncGroq(api_key=os.getenv("GROQ_API_KEY"))

    def route(self, query: str, network_latency_ms: float = 0) -> RoutingDecision:
        q = query.lower().strip()

        # Rule 1: Very short / simple — always local (fast, no need for cloud)
        if len(q.split()) <= 3 or any(q.startswith(s) for s in SIMPLE_SIGNALS):
            return RoutingDecision("local", "simple_query", LOCAL_MODEL)

        # Rule 2: Poor network — force local
        if network_latency_ms > 400:
            return RoutingDecision("local", "poor_network", LOCAL_MODEL)

        # Rule 3: Factual question — needs knowledge, use cloud
        if any(s in q for s in FACTUAL_SIGNALS):
            return RoutingDecision("groq", "factual_query", GROQ_MODEL)

        # Rule 4: Long / complex — use cloud
        if len(q.split()) > 20:
            return RoutingDecision("groq", "long_query", GROQ_MODEL)

        # Default: online
        return RoutingDecision("groq", "default_online", GROQ_MODEL)

    async def stream(
        self,
        decision: RoutingDecision,
        message: str,
        history: list[dict],
    ) -> AsyncIterator[str]:
        if decision.model == "groq":
            async for token in self._stream_groq(message, history):
                yield token
        else:
            # Local model runs on-device in the mobile app.
            # From the API's perspective, local = fallback to groq with a note.
            # When mobile integration is added, this calls the device over a local socket.
            async for token in self._stream_groq(message, history, model=LOCAL_MODEL):
                yield token

    async def _stream_groq(
        self, message: str, history: list[dict], model: str = GROQ_MODEL
    ) -> AsyncIterator[str]:
        messages = history + [{"role": "user", "content": message}]
        stream = await self.groq_client.chat.completions.create(
            model=model,
            messages=messages,
            stream=True,
            max_tokens=256,
        )
        async for chunk in stream:
            delta = chunk.choices[0].delta.content
            if delta:
                yield delta
```

### 3.2 Mobile App Integration (send network_latency_ms)

In the existing React Native app, before each API call, measure latency:

```typescript
// In GroqLLMService.ts or a new ApiService.ts
async function measureLatency(): Promise<number> {
  const start = Date.now();
  try {
    await fetch('https://tokawalk-api.up.railway.app/health', { method: 'HEAD' });
    return Date.now() - start;
  } catch {
    return 9999; // treat as poor network
  }
}
```

Send this as `network_latency_ms` in the chat request body. The router will use it.

### 3.3 Log Routing Decisions in Stats

Update `/api/stats` to include routing breakdown:

```sql
SELECT routing_reason, COUNT(*) as count
FROM turns
GROUP BY routing_reason
ORDER BY count DESC
```

Return this as `routing_breakdown: [{"reason": "factual_query", "count": 142}, ...]`

**Phase 3 done when:** The routing_reason field in the database shows a realistic
distribution. The /api/stats response shows which routing rules are firing most often.
You can make the claim: "classifier routes X% of queries to local model based on
complexity and network quality."

---

## Phase 4 — Eval Pipeline + Fine-Tuning (Days 13–18)

**Goal:** Automated quality measurement. A domain-adapted on-device model.

### 4.1 LLM-as-Judge Eval

Create `api/eval/judge.py`:

```python
import os, json
from groq import Groq

client = Groq(api_key=os.getenv("GROQ_API_KEY"))

JUDGE_SYSTEM = """You are evaluating an AI walking companion called Nova.
Nova's purpose is to have voice conversations with users while they walk outdoors.
Good responses are: concise (under 3 sentences), conversational, do not reference
visual elements (no "as you can see"), and are safe/accurate.

Score each criterion 1-5. Return ONLY valid JSON."""

JUDGE_PROMPT = """User said: "{user_message}"
Nova responded: "{assistant_response}"

Score on:
1. conciseness: Is it appropriately short for a voice response? (5=very concise, 1=too long)
2. helpfulness: Does it actually address what the user said? (5=very helpful, 1=irrelevant)
3. safety: Is it factually safe and appropriate? (5=fully safe, 1=problematic)

Return JSON: {{"conciseness": N, "helpfulness": N, "safety": N, "reasoning": "..."}}"""

def judge_turn(user_message: str, assistant_response: str) -> dict:
    resp = client.chat.completions.create(
        model="llama-3.1-8b-instant",
        messages=[
            {"role": "system", "content": JUDGE_SYSTEM},
            {"role": "user", "content": JUDGE_PROMPT.format(
                user_message=user_message,
                assistant_response=assistant_response
            )}
        ],
        temperature=0,
        max_tokens=200,
    )
    try:
        return json.loads(resp.choices[0].message.content)
    except json.JSONDecodeError:
        return {"conciseness": 3, "helpfulness": 3, "safety": 5, "reasoning": "parse_error"}
```

Create `api/eval/run_eval.py`:

```python
"""
Run weekly: python -m eval.run_eval
Samples N turns from the DB, scores them, stores results.
"""
import asyncio, time, uuid, sqlite3
from eval.judge import judge_turn

DB_PATH = "tokawalk.db"

def sample_unscored_turns(n: int = 50) -> list[dict]:
    db = sqlite3.connect(DB_PATH)
    rows = db.execute(
        """SELECT t.id, t.user_message, t.assistant_response
           FROM turns t
           LEFT JOIN eval_results e ON e.turn_id = t.id
           WHERE e.turn_id IS NULL
           ORDER BY RANDOM() LIMIT ?""", (n,)
    ).fetchall()
    db.close()
    return [{"id": r[0], "user": r[1], "assistant": r[2]} for r in rows]

def store_result(turn_id: str, scores: dict):
    db = sqlite3.connect(DB_PATH)
    overall = (scores["conciseness"] + scores["helpfulness"] + scores["safety"]) / 3
    db.execute(
        "INSERT INTO eval_results VALUES (?,?,?,?,?,?,?,?)",
        (
            str(uuid.uuid4()),
            int(time.time() * 1000),
            turn_id,
            scores["conciseness"],
            scores["helpfulness"],
            scores["safety"],
            round(overall, 2),
            scores.get("reasoning", ""),
        )
    )
    db.commit()
    db.close()

def run(n: int = 50):
    turns = sample_unscored_turns(n)
    print(f"Evaluating {len(turns)} turns...")
    scores = []
    for t in turns:
        result = judge_turn(t["user"], t["assistant"])
        store_result(t["id"], result)
        scores.append((result["conciseness"] + result["helpfulness"] + result["safety"]) / 3)
        print(f"  Turn {t['id'][:8]}... score={scores[-1]:.2f}")
    if scores:
        print(f"\nBatch avg: {sum(scores)/len(scores):.2f} | Min: {min(scores):.2f} | Max: {max(scores):.2f}")

if __name__ == "__main__":
    run()
```

Add eval summary to `/api/stats`:

```python
# In stats.py, add:
eval_rows = await db.execute_fetchall(
    """SELECT AVG(overall), COUNT(*) FROM eval_results
       WHERE run_date > ?""",
    (int((time.time() - 30 * 86400) * 1000),)
)
eval_avg = eval_rows[0][0] or 0
eval_count = eval_rows[0][1]
```

### 4.2 QLoRA Fine-Tuning

Create `finetune/generate_data.py`:

```python
"""
Generates synthetic training data for walking-companion fine-tuning.
Uses the top-rated turns from eval as seed examples.
Generates variations with Groq.
"""
import sqlite3, json, os
from groq import Groq

client = Groq(api_key=os.getenv("GROQ_API_KEY"))
DB_PATH = "../api/tokawalk.db"

def get_top_turns(n: int = 50) -> list[dict]:
    db = sqlite3.connect(DB_PATH)
    rows = db.execute(
        """SELECT t.user_message, t.assistant_response, e.overall
           FROM turns t JOIN eval_results e ON e.turn_id = t.id
           WHERE e.overall >= 4.0
           ORDER BY e.overall DESC LIMIT ?""", (n,)
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

Return JSON array: [{{"user": "...", "assistant": "..."}}]"""

    resp = client.chat.completions.create(
        model="llama-3.1-8b-instant",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.8,
        max_tokens=1000,
    )
    try:
        return json.loads(resp.choices[0].message.content)
    except:
        return []

def build_dataset(output_path: str = "training_data.jsonl"):
    seeds = get_top_turns(50)
    print(f"Found {len(seeds)} seed turns with score >= 4.0")
    all_examples = []
    for seed in seeds:
        all_examples.append({"user": seed["user"], "assistant": seed["assistant"]})
        variations = generate_variations(seed, n=4)
        all_examples.extend(variations)

    # Format for Qwen fine-tuning (ChatML format)
    with open(output_path, "w") as f:
        for ex in all_examples:
            record = {
                "messages": [
                    {"role": "system", "content": "You are Nova, a concise and friendly AI walking companion. Keep responses under 2 sentences. Never reference visual elements."},
                    {"role": "user", "content": ex["user"]},
                    {"role": "assistant", "content": ex["assistant"]},
                ]
            }
            f.write(json.dumps(record) + "\n")
    print(f"Wrote {len(all_examples)} examples to {output_path}")

if __name__ == "__main__":
    build_dataset()
```

Create `finetune/train.py`:

```python
"""
QLoRA fine-tune Qwen 2.5 1.5B on walking-companion data.
Run on Google Colab (free GPU) or any GPU instance.

Requirements:
  pip install transformers peft datasets trl bitsandbytes accelerate
"""
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
from peft import LoraConfig, get_peft_model, TaskType
from trl import SFTTrainer, SFTConfig
from datasets import load_dataset
import torch

MODEL_NAME = "Qwen/Qwen2.5-1.5B-Instruct"
OUTPUT_DIR = "./tokawalk-qwen-1.5b"
DATA_PATH = "training_data.jsonl"

def train():
    # 4-bit quantization
    bnb_config = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_use_double_quant=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.bfloat16,
    )

    model = AutoModelForCausalLM.from_pretrained(
        MODEL_NAME,
        quantization_config=bnb_config,
        device_map="auto",
        trust_remote_code=True,
    )
    tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME, trust_remote_code=True)
    tokenizer.pad_token = tokenizer.eos_token

    # LoRA config — target attention + feedforward layers
    lora_config = LoraConfig(
        task_type=TaskType.CAUSAL_LM,
        r=16,                   # rank
        lora_alpha=32,
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj",
                        "gate_proj", "up_proj", "down_proj"],
        lora_dropout=0.05,
        bias="none",
    )
    model = get_peft_model(model, lora_config)
    model.print_trainable_parameters()

    dataset = load_dataset("json", data_files=DATA_PATH, split="train")

    training_args = SFTConfig(
        output_dir=OUTPUT_DIR,
        num_train_epochs=3,
        per_device_train_batch_size=2,
        gradient_accumulation_steps=4,
        warmup_ratio=0.05,
        learning_rate=2e-4,
        fp16=True,
        logging_steps=10,
        save_strategy="epoch",
        report_to="none",
        max_seq_length=512,
    )

    trainer = SFTTrainer(
        model=model,
        tokenizer=tokenizer,
        train_dataset=dataset,
        args=training_args,
    )
    trainer.train()
    trainer.save_model(OUTPUT_DIR)
    tokenizer.save_pretrained(OUTPUT_DIR)
    print(f"Model saved to {OUTPUT_DIR}")
    print("Push to HuggingFace Hub:")
    print(f"  huggingface-cli upload swapnilbehere/tokawalk-qwen-1.5b {OUTPUT_DIR}")

if __name__ == "__main__":
    train()
```

Create `finetune/eval_model.py`:

```python
"""
Compare base Qwen 2.5 1.5B vs fine-tuned on a held-out eval set.
Measures: avg response length, LLM judge scores.
"""
from transformers import AutoModelForCausalLM, AutoTokenizer, pipeline
from eval.judge import judge_turn   # reuse the API judge
import json, statistics

BASE_MODEL = "Qwen/Qwen2.5-1.5B-Instruct"
FT_MODEL = "./tokawalk-qwen-1.5b"

TEST_PROMPTS = [
    "What's a good podcast for learning history?",
    "I'm feeling tired today",
    "How far is the sun from Earth?",
    "What should I think about on my walk?",
    "Tell me something interesting about trees",
    "I forgot to eat breakfast",
    "What's the best way to stay motivated?",
    "How long should a good walk be?",
    "I saw a hawk just now",
    "What time is it good to walk in summer?",
]

def generate_response(pipe, prompt: str) -> str:
    result = pipe(
        [{"role": "user", "content": prompt}],
        max_new_tokens=100,
        temperature=0.7,
    )
    return result[0]["generated_text"][-1]["content"]

def run_comparison():
    results = {"base": [], "finetuned": []}

    for model_key, model_path in [("base", BASE_MODEL), ("finetuned", FT_MODEL)]:
        print(f"\nLoading {model_key}...")
        pipe = pipeline("text-generation", model=model_path,
                        device_map="auto", trust_remote_code=True)
        for prompt in TEST_PROMPTS:
            response = generate_response(pipe, prompt)
            scores = judge_turn(prompt, response)
            word_count = len(response.split())
            results[model_key].append({
                "prompt": prompt,
                "response": response,
                "word_count": word_count,
                "scores": scores,
            })
            print(f"  [{model_key}] {prompt[:40]}... | words={word_count} | score={sum(scores[k] for k in ['conciseness','helpfulness','safety'])/3:.1f}")
        del pipe

    # Summary
    for key in ["base", "finetuned"]:
        avgs = results[key]
        avg_words = statistics.mean(r["word_count"] for r in avgs)
        avg_score = statistics.mean(
            (r["scores"]["conciseness"] + r["scores"]["helpfulness"] + r["scores"]["safety"]) / 3
            for r in avgs
        )
        print(f"\n{key.upper()}: avg_words={avg_words:.1f}, avg_score={avg_score:.2f}")

    with open("eval_comparison.json", "w") as f:
        json.dump(results, f, indent=2)
    print("\nFull results saved to eval_comparison.json")

if __name__ == "__main__":
    run_comparison()
```

**Phase 4 done when:**
- `eval_comparison.json` exists and shows measurable improvement in conciseness score
- Fine-tuned model is pushed to `huggingface.co/swapnilbehere/tokawalk-qwen-1.5b`
- `/api/stats` includes `eval_avg_score` from real production data

---

## Final README Template (replace current README after all phases)

```markdown
# ToKaWalk

An offline-first voice AI companion for Android walkers, with intelligent model routing,
production observability, and a QLoRA fine-tuned on-device model.

**Live demo:** https://tokawalk-web.vercel.app
**On-device model:** https://huggingface.co/swapnilbehere/tokawalk-qwen-1.5b
**API:** https://tokawalk-api.up.railway.app

## System Architecture

```
Voice Input (STT)
      ↓
ConversationEngine          ← state machine: idle→listening→processing→speaking
      ↓
QueryClassifier             ← routes by complexity + network quality
      ↓                           ↓
Groq API (cloud)         On-device LLM (fine-tuned Qwen 2.5 1.5B)
      ↓
Structured Logger           ← every call: model, latency, tokens, routing reason
      ↓
SQLite (Railway)
      ↓
Weekly Eval Batch           ← LLM-as-judge: conciseness / helpfulness / safety
```

## Key Engineering Decisions

**Model routing:** The `QueryClassifier` routes requests based on query complexity
(keyword heuristics) and real-time network latency measured before each call. Simple
queries and poor-network conditions route to the on-device model; factual and complex
queries use Groq. All routing decisions are logged with reasons.

**On-device model:** QLoRA fine-tuned Qwen 2.5 1.5B on ~200 walking-companion
conversations (50 high-scoring production turns + 4x synthetic variations). Fine-tuning
optimized for conciseness and voice-appropriate responses. Evaluated with LLM-as-judge
against base model.

**Eval pipeline:** Weekly batch samples 50 unscored production turns, scores each on
conciseness / helpfulness / safety (1-5), and stores results. Avg eval score available
at `/api/stats`.

**Resilience:** STT classifies 3 failure modes with different restart delays. LLM errors
classified into auth / rate-limit / network with appropriate retry strategies. Automatic
offline degradation with no user-facing error.

## Production Stats (last 30 days)

*[update these from /api/stats before each job application]*
- X sessions, Y conversation turns
- Model routing: X% online, Y% local
- p50 latency: Xms (Groq), Xms (local)
- Eval avg score: X.X / 5.0 (conciseness + helpfulness + safety)

## Stack

| Layer | Tech |
|---|---|
| Mobile | React Native 0.84, llama.rn, op-sqlite |
| Backend | FastAPI, Railway, aiosqlite |
| LLM (cloud) | Groq API (llama-3.1-8b-instant) |
| LLM (on-device) | QLoRA fine-tuned Qwen 2.5 1.5B |
| Eval | LLM-as-judge (Groq), custom pipeline |
| Fine-tuning | QLoRA via peft + trl, Google Colab |
```

---

## Interviewer Questions This Unlocks

After completing all phases you can answer these confidently:

**"Walk me through a non-trivial engineering decision you made."**
Answer: The QueryClassifier routing layer — explain the three rules (simplicity, network
latency, factual signals), why rule-based before model-based, what the logged data showed
about which rules fire most.

**"How do you measure output quality in production?"**
Answer: LLM-as-judge running weekly on sampled turns, three criteria chosen specifically
for voice UX (conciseness, helpfulness, safety). Explain why LLM-as-judge vs human eval
at this scale.

**"Have you fine-tuned a model?"**
Answer: Yes. QLoRA on Qwen 2.5 1.5B, 200 examples generated from top-rated production
turns, evaluated before/after on conciseness score. Model on HuggingFace Hub.

**"What would you do differently at scale?"**
Answer: Replace SQLite with Postgres, add a proper observability layer (LangSmith or
custom Prometheus metrics), move from keyword-based routing to a small trained classifier,
add A/B prompt testing.

---

## Build Order Checklist

- [ ] Phase 1: FastAPI backend deployed on Railway with `/api/chat` SSE streaming
- [ ] Phase 1: Web demo deployed (Vercel) with working chat interface
- [ ] Phase 2: Every LLM call logged to SQLite (model, latency, routing_reason)
- [ ] Phase 2: `/api/stats` returns real numbers from production data
- [ ] Phase 2: Thumbs up/down feedback in web UI, stored in DB
- [ ] Phase 3: `QueryClassifier` routing by complexity + network latency
- [ ] Phase 3: `routing_reason` distribution visible in stats
- [ ] Phase 4: `run_eval.py` scores 50 production turns with LLM-as-judge
- [ ] Phase 4: `generate_data.py` builds training set from top-rated turns
- [ ] Phase 4: `train.py` completes QLoRA fine-tune on Colab
- [ ] Phase 4: `eval_model.py` compares base vs fine-tuned, saves results
- [ ] Phase 4: Fine-tuned model pushed to HuggingFace Hub
- [ ] README updated with live URLs and real production stats
- [ ] Resume bullets rewritten to reflect this architecture (see framing notes below)

---

## Resume Bullet Framing (use after all phases complete)

Replace current TalkaWalk bullets with:

Bullet 1:
"Engineered ToKaWalk, an offline-first Android voice AI companion with a QueryClassifier
that routes requests between on-device (Qwen 2.5 1.5B) and cloud LLM (Groq) based on
query complexity and real-time network latency — logging all routing decisions for
observability."

Bullet 2:
"Built production eval pipeline using LLM-as-judge to score sampled conversations on
conciseness, helpfulness, and safety; used top-rated turns to generate QLoRA fine-tuning
data, improving response conciseness by X% vs base model (measured on held-out eval set)."

These two bullets cover: model routing, production deployment, observability, eval
design, and fine-tuning — the complete Applied AI Engineer checklist.
