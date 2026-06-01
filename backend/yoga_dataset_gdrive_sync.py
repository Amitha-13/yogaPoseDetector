#!/usr/bin/env python3
"""
Background Google Drive sync for YogaDataset (D:\\ or E:\\YogaDataset).

Runs independently of the React UI. Local save is always primary; this only
uploads new/changed files to the shared Drive folder.

Usage:
  python yoga_dataset_gdrive_sync.py --once
  python yoga_dataset_gdrive_sync.py --loop
  python yoga_dataset_gdrive_sync.py --loop --interval 300
  python yoga_dataset_gdrive_sync.py --status

Requires backend/gdrive_service_account.json (or GOOGLE_APPLICATION_CREDENTIALS).
"""

from __future__ import annotations

import argparse
import json
import sys

from gdrive_sync import get_sync_status, run_incremental_sync, run_sync_loop


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Sync local YogaDataset to Google Drive (incremental)"
    )
    parser.add_argument(
        "--once",
        action="store_true",
        help="Run a single sync cycle and exit",
    )
    parser.add_argument(
        "--loop",
        action="store_true",
        help="Run sync every --interval seconds until interrupted",
    )
    parser.add_argument(
        "--interval",
        type=int,
        default=300,
        help="Seconds between sync cycles in --loop mode (default: 300)",
    )
    parser.add_argument(
        "--status",
        action="store_true",
        help="Print sync status JSON and exit",
    )
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if args.status:
        print(json.dumps(get_sync_status(), indent=2))
        return

    if args.loop:
        run_sync_loop(interval_sec=max(30, args.interval))
        return

    if args.once or not (args.loop or args.status):
        result = run_incremental_sync(dry_run=args.dry_run)
        print(json.dumps(result, indent=2))
        if not result.get("ok"):
            raise SystemExit(1)
        return

    parser.print_help()
    raise SystemExit(1)


if __name__ == "__main__":
    main()
