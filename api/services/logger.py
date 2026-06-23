import asyncio
import time

from db.database import get_db


def log_turn(
    *,
    turn_id: str,
    session_id: str,
    user_message: str,
    assistant_response: str,
    model_used: str,
    latency_ms: float,
    routing_reason: str,
    input_tokens: int | None = None,
    output_tokens: int | None = None,
    error_type: str | None = None,
    retry_count: int = 0,
) -> None:
    asyncio.create_task(
        _write_turn(
            turn_id=turn_id,
            session_id=session_id,
            user_message=user_message,
            assistant_response=assistant_response,
            model_used=model_used,
            latency_ms=latency_ms,
            routing_reason=routing_reason,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            error_type=error_type,
            retry_count=retry_count,
        )
    )


async def _write_turn(
    *,
    turn_id: str,
    session_id: str,
    user_message: str,
    assistant_response: str,
    model_used: str,
    latency_ms: float,
    routing_reason: str,
    input_tokens: int | None,
    output_tokens: int | None,
    error_type: str | None,
    retry_count: int,
) -> None:
    async with get_db() as db:
        await db.execute(
            """INSERT INTO turns
               (id, session_id, timestamp, user_message, assistant_response,
                model_used, latency_ms, input_tokens, output_tokens,
                error_type, retry_count, routing_reason, feedback)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)""",
            (
                turn_id,
                session_id,
                int(time.time() * 1000),
                user_message,
                assistant_response,
                model_used,
                latency_ms,
                input_tokens,
                output_tokens,
                error_type,
                retry_count,
                routing_reason,
            ),
        )
        await db.commit()
