import os
from dataclasses import dataclass
from typing import AsyncIterator, Literal

from groq import AsyncGroq

GROQ_MODEL = "llama-3.1-8b-instant"

NOVA_SYSTEM = (
    "You are Nova, a friendly and concise AI walking companion. "
    "You help users enjoy their walks with short, engaging responses. "
    "Keep every response under 3 sentences. Never reference visual elements."
)

FACTUAL_SIGNALS = [
    "what is", "who is", "when did", "how many", "where is",
    "what are", "define ", "explain ", "tell me about",
    "what does", "how does", "why does",
]

SIMPLE_SIGNALS = [
    "thanks", "thank you", "ok", "okay", "got it", "sure",
    "yes", "no", "bye", "goodbye", "hello", "hi",
]


@dataclass
class RoutingDecision:
    model: Literal["groq", "local"]
    reason: str
    model_id: str


class LLMRouter:
    def __init__(self) -> None:
        self.client = AsyncGroq(api_key=os.environ["GROQ_API_KEY"])

    def route(self, query: str, network_latency_ms: float = 0.0) -> RoutingDecision:
        q = query.lower().strip()

        if len(q.split()) <= 3 or any(q.startswith(s) for s in SIMPLE_SIGNALS):
            return RoutingDecision("local", "simple_query", GROQ_MODEL)

        if network_latency_ms > 400:
            return RoutingDecision("local", "poor_network", GROQ_MODEL)

        if any(s in q for s in FACTUAL_SIGNALS):
            return RoutingDecision("groq", "factual_query", GROQ_MODEL)

        if len(q.split()) > 20:
            return RoutingDecision("groq", "long_query", GROQ_MODEL)

        return RoutingDecision("groq", "default_online", GROQ_MODEL)

    async def stream(
        self,
        decision: RoutingDecision,
        message: str,
        history: list[dict],
        system_prompt: str | None = None,
    ) -> AsyncIterator[str]:
        # Both paths use Groq in Phase 1; on-device routing activates when
        # the mobile app sends requests directly. Local decisions get fewer tokens
        # to simulate the tighter budget of an on-device model.
        max_tokens = 128 if decision.model == "local" else 256
        system = system_prompt or NOVA_SYSTEM
        messages = [{"role": "system", "content": system}] + history + [
            {"role": "user", "content": message}
        ]
        response = await self.client.chat.completions.create(
            model=GROQ_MODEL,
            messages=messages,
            stream=True,
            max_tokens=max_tokens,
        )
        async for chunk in response:
            delta = chunk.choices[0].delta.content
            if delta:
                yield delta
