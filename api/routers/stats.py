import time

from fastapi import APIRouter

from db.database import get_db

router = APIRouter()


@router.get("/stats")
async def stats():
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT COUNT(DISTINCT session_id), COUNT(*) FROM turns"
        )
        row = await cursor.fetchone()
        total_sessions, total_turns = row or (0, 0)

        cursor = await db.execute(
            "SELECT COUNT(*) FROM turns WHERE model_used LIKE 'groq%'"
        )
        row = await cursor.fetchone()
        online_count = (row[0] if row else 0)

        cursor = await db.execute(
            "SELECT COUNT(*) FROM turns WHERE error_type IS NOT NULL"
        )
        row = await cursor.fetchone()
        error_count = row[0] if row else 0

        cursor = await db.execute("SELECT latency_ms FROM turns ORDER BY latency_ms")
        latencies = [r[0] for r in await cursor.fetchall()]

        cutoff = int((time.time() - 30 * 86400) * 1000)
        cursor = await db.execute(
            """SELECT date(timestamp / 1000, 'unixepoch') AS d, COUNT(DISTINCT session_id)
               FROM turns WHERE timestamp > ? GROUP BY d ORDER BY d""",
            (cutoff,),
        )
        daily = await cursor.fetchall()

        cursor = await db.execute(
            """SELECT routing_reason, COUNT(*) FROM turns
               GROUP BY routing_reason ORDER BY COUNT(*) DESC"""
        )
        routing = await cursor.fetchall()

        cutoff_30d = int((time.time() - 30 * 86400) * 1000)
        cursor = await db.execute(
            """SELECT AVG(overall), COUNT(*) FROM eval_results
               WHERE run_date > ?""",
            (cutoff_30d,),
        )
        eval_row = await cursor.fetchone()
        eval_avg = round(eval_row[0], 2) if eval_row and eval_row[0] else None
        eval_count = eval_row[1] if eval_row else 0

    total = total_turns or 1
    p50 = latencies[len(latencies) // 2] if latencies else 0
    p95 = latencies[int(len(latencies) * 0.95)] if latencies else 0

    return {
        "total_sessions": total_sessions,
        "total_turns": total_turns,
        "online_pct": round(online_count / total * 100, 1),
        "local_pct": round((total_turns - online_count) / total * 100, 1),
        "p50_latency_ms": round(p50, 1),
        "p95_latency_ms": round(p95, 1),
        "error_rate": round(error_count / total * 100, 1),
        "daily_sessions": [{"date": r[0], "count": r[1]} for r in daily],
        "routing_breakdown": [{"reason": r[0], "count": r[1]} for r in routing],
        "eval_avg_score": eval_avg,
        "eval_count": eval_count,
    }
