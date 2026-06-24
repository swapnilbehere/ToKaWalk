"""
QLoRA fine-tune Qwen 2.5 1.5B on ToKaWalk walking-companion data.

Run on Google Colab (free T4 GPU) or any CUDA GPU instance.

Setup in Colab:
    !pip install transformers peft datasets trl bitsandbytes accelerate -q
    # Upload training_data.jsonl to Colab, then:
    !python train.py

After training:
    !huggingface-cli login
    !huggingface-cli upload swapnilbehere/tokawalk-qwen-1.5b ./tokawalk-qwen-1.5b
"""
import torch
from datasets import load_dataset
from peft import LoraConfig, TaskType, get_peft_model
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
from trl import SFTConfig, SFTTrainer

MODEL_NAME = "Qwen/Qwen2.5-1.5B-Instruct"
OUTPUT_DIR = "./tokawalk-qwen-1.5b"
DATA_PATH = "training_data.jsonl"


def train() -> None:
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

    lora_config = LoraConfig(
        task_type=TaskType.CAUSAL_LM,
        r=16,
        lora_alpha=32,
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj",
                        "gate_proj", "up_proj", "down_proj"],
        lora_dropout=0.05,
        bias="none",
    )
    model = get_peft_model(model, lora_config)
    model.print_trainable_parameters()

    dataset = load_dataset("json", data_files=DATA_PATH, split="train")
    print(f"Training on {len(dataset)} examples")

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

    print(f"\nModel saved to {OUTPUT_DIR}")
    print("\nTo push to HuggingFace Hub:")
    print("  huggingface-cli login")
    print(f"  huggingface-cli upload swapnilbehere/tokawalk-qwen-1.5b {OUTPUT_DIR}")


if __name__ == "__main__":
    train()
