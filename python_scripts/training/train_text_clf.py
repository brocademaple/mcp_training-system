#!/usr/bin/env python3
"""
Text classification training script for MCP Training System
Uses BERT model for text classification
"""

import sys
import json
import torch
from datasets import load_dataset
from transformers import (
    AutoTokenizer,
    AutoModelForSequenceClassification,
    TrainingArguments,
    Trainer,
    TrainerCallback
)


class ProgressCallback(TrainerCallback):
    """Callback to output training progress for Go to parse"""

    def on_log(self, args, state, control, logs=None, **kwargs):
        """Called when logging occurs during training"""
        if logs:
            progress = {
                "epoch": state.epoch if state.epoch else 0,
                "loss": logs.get("loss", 0),
                "learning_rate": logs.get("learning_rate", 0),
                "step": state.global_step,
                "max_steps": state.max_steps
            }
            # Output to stdout for Go to parse
            print(f"PROGRESS:{json.dumps(progress)}", flush=True)


def train_text_classification(dataset_path, hyperparams):
    """Train a text classification model"""
    try:
        # Load dataset
        dataset = load_dataset('csv', data_files={'train': dataset_path})

        # Load tokenizer
        tokenizer = AutoTokenizer.from_pretrained("bert-base-uncased")

        # Tokenize function
        def tokenize_function(examples):
            return tokenizer(examples["text"], padding="max_length", truncation=True, max_length=128)

        # Tokenize dataset
        tokenized_dataset = dataset.map(tokenize_function, batched=True)

        # Load model
        model = AutoModelForSequenceClassification.from_pretrained(
            "bert-base-uncased",
            num_labels=2
        )

        # Training arguments
        training_args = TrainingArguments(
            output_dir="./results",
            learning_rate=hyperparams.get('learning_rate', 2e-5),
            per_device_train_batch_size=hyperparams.get('batch_size', 16),
            num_train_epochs=hyperparams.get('epochs', 3),
            logging_steps=10,
            save_strategy="epoch",
            report_to="none"
        )

        # Create trainer
        trainer = Trainer(
            model=model,
            args=training_args,
            train_dataset=tokenized_dataset['train'],
            callbacks=[ProgressCallback()]
        )

        # Train model
        trainer.train()

        # Save model
        model_save_path = f"./data/models/job_{hyperparams.get('job_id', 'unknown')}"
        trainer.save_model(model_save_path)

        # Get final loss
        final_loss = 0
        if trainer.state.log_history:
            for log in reversed(trainer.state.log_history):
                if 'loss' in log:
                    final_loss = log['loss']
                    break

        # Return success result
        result = {
            "status": "success",
            "model_path": model_save_path,
            "final_loss": final_loss
        }
        print(json.dumps(result))

    except Exception as e:
        # Return error result
        error_result = {
            "status": "error",
            "error_message": str(e)
        }
        print(json.dumps(error_result))
        sys.exit(1)


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"status": "error", "error_message": "Missing arguments"}))
        sys.exit(1)

    dataset_path = sys.argv[1]
    hyperparams = json.loads(sys.argv[2])

    train_text_classification(dataset_path, hyperparams)
