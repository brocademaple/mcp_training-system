# Evaluation Agent Skill

## Scope
- Input: completed evaluation metrics and training signals.
- Responsibility: explain model effect and provide next-step suggestions.
- Out of scope: automatic hyperparameter search / auto-tuning.

## Input Signals
- accuracy / precision / recall / f1
- optional roc_auc
- training log trend (loss, train accuracy)
- dataset row count

## Output Schema
- `effect`
- `summary`
- `possible_issues`
- `recommendations`
- `signals`
