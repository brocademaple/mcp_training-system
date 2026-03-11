#!/usr/bin/env python3
"""
Data cleaning script for MCP Training System
Removes duplicates and missing values from CSV files
"""

import sys
import json
import pandas as pd


def _read_csv_with_encoding(file_path):
    """Try multiple encodings for CSV (handles Chinese and BOM)."""
    for encoding in ('utf-8', 'utf-8-sig', 'gbk', 'gb18030', 'latin1'):
        try:
            return pd.read_csv(file_path, encoding=encoding)
        except (UnicodeDecodeError, UnicodeError):
            continue
    raise ValueError(
        "Could not decode CSV with utf-8, utf-8-sig, gbk, gb18030, or latin1. "
        "Please ensure the file is a valid CSV with one of these encodings."
    )


def clean_data(file_path):
    """Clean data by removing duplicates and missing values"""
    try:
        # Read file based on extension
        if file_path.endswith('.json'):
            df = pd.read_json(file_path)
            output_path = file_path.replace('.json', '_cleaned.csv')
        else:
            df = _read_csv_with_encoding(file_path)
            output_path = file_path.replace('.csv', '_cleaned.csv')

        original_rows = len(df)

        # Remove duplicates
        df = df.drop_duplicates()

        # Remove missing values
        df = df.dropna()

        # Save as CSV (UTF-8 for consistency)
        df.to_csv(output_path, index=False, encoding='utf-8')

        # Return success result
        result = {
            "status": "success",
            "original_rows": original_rows,
            "cleaned_rows": len(df),
            "columns": list(df.columns),
            "output_path": output_path
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
    clean_data(file_path)
