#!/usr/bin/env python3
"""
Data analysis script for MCP Training System
Generates statistics and insights from CSV files
"""

import sys
import json
import pandas as pd
import numpy as np


def analyze_data(file_path):
    """Analyze data and generate statistics"""
    try:
        # Read CSV file
        df = pd.read_csv(file_path)

        # Initialize stats dictionary
        stats = {}

        # Analyze each column
        for col in df.columns:
            col_stats = {
                "type": str(df[col].dtype),
                "null_count": int(df[col].isnull().sum())
            }

            # Numeric columns
            if pd.api.types.is_numeric_dtype(df[col]):
                col_stats["mean"] = float(df[col].mean())
                col_stats["std"] = float(df[col].std())
                col_stats["min"] = float(df[col].min())
                col_stats["max"] = float(df[col].max())

            # Categorical columns
            else:
                value_counts = df[col].value_counts().head(10)
                col_stats["distribution"] = {
                    str(k): int(v) for k, v in value_counts.items()
                }

            stats[col] = col_stats

        # Return success result
        result = {
            "status": "success",
            "row_count": len(df),
            "column_count": len(df.columns),
            "stats": stats
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
    if len(sys.argv) < 2:
        print(json.dumps({"status": "error", "error_message": "Missing file path"}))
        sys.exit(1)

    file_path = sys.argv[1]
    analyze_data(file_path)
