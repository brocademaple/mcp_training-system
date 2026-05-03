# Data Agent Skill

## Scope
- Input: one uploaded dataset file already in system storage.
- Responsibility: evaluate data reliability and trainability only.
- Out of scope: auto-crawl data, auto-generate full dataset, external search.

## Workflow
1. Run deterministic script: `python_scripts/data/analyze_data.py`
2. Match task template using `python_scripts/data/assets/task_templates.json`
3. Generate structured report (rule-based), then optionally enhance summary with LLM.

## Output Schema
- `task_type`
- `confidence`
- `trainability`
- `reliability`
- `issues`
- `summary`
- `recommendations`
- `stats`
