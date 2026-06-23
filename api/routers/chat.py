import json
import time
import uuid

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
        error_type = None
        try:
            async for token in llm_router.stream(decision, req.message, req.history, req.system_prompt):
                full_response += token
                yield f"data: {token}\n\n"
        except Exception as exc:
            error_type = "stream_error"
            yield f"data: [ERROR] {exc}\n\n"

        latency_ms = (time.time() - start) * 1000
        log_turn(
            turn_id=turn_id,
            session_id=req.session_id,
            user_message=req.message,
            assistant_response=full_response,
            model_used=decision.model_id,
            latency_ms=latency_ms,
            routing_reason=decision.reason,
            error_type=error_type,
        )
        done_payload = json.dumps({
            "turn_id": turn_id,
            "model": decision.model_id,
            "reason": decision.reason,
        })
        yield f"data: [DONE] {done_payload}\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream")
