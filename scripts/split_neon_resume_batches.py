from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "generated" / "neon-migrations"
OUT = ROOT / "generated" / "neon-resume"
START_BATCH = 7

ENUM_ADD = re.compile(r"^ALTER\s+TYPE\b.*\bADD\s+VALUE\b", re.IGNORECASE | re.DOTALL)


def write_batch(index: int, statements: list[str]) -> int:
    if not statements:
        return index
    payload = {"projectId": "quiet-heart-24036829", "databaseName": "neondb", "sqlStatements": statements}
    (OUT / f"batch-{index:03d}.json").write_text(json.dumps(payload, indent=2) + "\n")
    return index + 1


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for path in OUT.glob("batch-*.json"):
        path.unlink()

    next_index = 1
    emitted = []
    for source_index in range(START_BATCH, 18):
        payload = json.loads((SRC / f"batch-{source_index:03d}.json").read_text())
        statements = payload["sqlStatements"]
        current: list[str] = []
        for statement in statements:
            if ENUM_ADD.match(statement.strip()):
                next_index = write_batch(next_index, current)
                current = []
                next_index = write_batch(next_index, [statement])
            else:
                current.append(statement)
        next_index = write_batch(next_index, current)
        emitted.append({"source_batch": source_index, "source_statements": len(statements)})

    manifest = {"source_start_batch": START_BATCH, "source_end_batch": 17, "resume_batches": next_index - 1, "sources": emitted}
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
