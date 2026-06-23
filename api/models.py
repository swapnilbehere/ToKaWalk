from typing import Literal

from pydantic import BaseModel


class ChatRequest(BaseModel):
    message: str
    session_id: str
    history: list[dict] = []
    network_latency_ms: float = 0.0
    system_prompt: str | None = None  # forwarded from mobile app; overrides default Nova prompt


class FeedbackRequest(BaseModel):
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
    daily_sessions: list[dict]
    routing_breakdown: list[dict]
