"""
Compare base Qwen 2.5 1.5B vs ToKaWalk fine-tuned model.
Measures: avg response word count and LLM-as-judge scores.

Run from finetune/ after training:
    GROQ_API_KEY=<key> python eval_model.py

Output: eval_comparison.json
"""
import json
import os
import statistics
import sys

from dotenv import load_dotenv

load_dotenv()

# Reuse judge from api/eval/
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "api"))
from eval.judge import judge_turn

from transformers import pipeline

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
        do_sample=True,
    )
    return result[0]["generated_text"][-1]["content"]


def run_comparison() -> None:
    results: dict[str, list] = {"base": [], "finetuned": []}

    for model_key, model_path in [("base", BASE_MODEL), ("finetuned", FT_MODEL)]:
        print(f"\n── Loading {model_key} ({model_path}) ──")
        pipe = pipeline(
            "text-generation",
            model=model_path,
            device_map="auto",
            trust_remote_code=True,
        )

        for prompt in TEST_PROMPTS:
            response = generate_response(pipe, prompt)
            scores = judge_turn(prompt, response)
            word_count = len(response.split())
            overall = (scores["conciseness"] + scores["helpfulness"] + scores["safety"]) / 3
            results[model_key].append({
                "prompt": prompt,
                "response": response,
                "word_count": word_count,
                "scores": scores,
            })
            print(
                f"  [{model_key}] {prompt[:45]:45s} | "
                f"words={word_count:3d} | score={overall:.1f}"
            )

        del pipe  # free GPU memory before loading next model

    # Summary table
    print("\n── Results ──")
    for key in ["base", "finetuned"]:
        items = results[key]
        avg_words = statistics.mean(r["word_count"] for r in items)
        avg_score = statistics.mean(
            (r["scores"]["conciseness"] + r["scores"]["helpfulness"] + r["scores"]["safety"]) / 3
            for r in items
        )
        print(f"  {key.upper():10s}: avg_words={avg_words:.1f}  avg_score={avg_score:.2f}/5.0")

    with open("eval_comparison.json", "w") as f:
        json.dump(results, f, indent=2)
    print("\nFull results → eval_comparison.json")


if __name__ == "__main__":
    run_comparison()
