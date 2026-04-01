#!/usr/bin/env python3
"""DPO 对齐训练入口（骨架）：校验偏好数据 JSONL 后占位完成；可替换为完整 TRL DPO 流程。"""
import json
import os
import sys


def main():
    if len(sys.argv) < 3:
        print("Usage: dpo_train.py <dataset_path> <hyperparams_json>", file=sys.stderr)
        sys.exit(1)
    dataset_path = sys.argv[1]
    hp = json.loads(sys.argv[2])
    print("LOG: DPO 训练入口（骨架）：读取超参并校验数据格式")
    ok = 0
    try:
        with open(dataset_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                obj = json.loads(line)
                for k in ("prompt", "chosen", "rejected"):
                    if k not in obj:
                        raise ValueError(f"missing field: {k}")
                ok += 1
    except Exception as e:
        print(f"LOG: 数据校验失败: {e}", flush=True)
        sys.exit(1)
    print(f"LOG: 已校验 {ok} 条偏好样本（prompt/chosen/rejected）", flush=True)
    out_dir = "./data/models/dpo_stub"
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "README.txt"), "w", encoding="utf-8") as out:
        out.write("DPO stub artifact\n")
    print(
        json.dumps(
            {
                "status": "success",
                "model_path": out_dir,
                "samples": ok,
            }
        ),
        flush=True,
    )


if __name__ == "__main__":
    main()
