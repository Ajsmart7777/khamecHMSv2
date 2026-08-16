from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "supabase" / "migrations"
OUT = ROOT / "generated" / "neon-migrations"
BATCH_SIZE = 80
MAX_BATCH_BYTES = 700_000


def strip_supabase_infrastructure(sql: str) -> str:
    # The three DO blocks that only manage the Supabase Realtime publication are
    # provider-specific. Their replica-identity work is not needed by Neon Data API.
    sql = re.sub(
        r"DO\s+\$\$.*?\$\$\s*;",
        lambda m: "" if "supabase_realtime" in m.group(0) else m.group(0),
        sql,
        flags=re.IGNORECASE | re.DOTALL,
    )

    # Remove unsupported extensions at the statement level after splitting. Keeping
    # the source text intact here prevents a regex from consuming valid policies or
    # table definitions that appear before a Storage policy in the same file.

    # Managed Better Auth stores identities in neon_auth.user (singular).
    sql = re.sub(r"\bauth\.users\b", "neon_auth.user", sql, flags=re.IGNORECASE)

    return sql


def split_sql(sql: str) -> list[str]:
    statements: list[str] = []
    start = 0
    i = 0
    quote: str | None = None
    dollar_tag: str | None = None
    line_comment = False
    block_comment = False

    while i < len(sql):
        ch = sql[i]
        nxt = sql[i + 1] if i + 1 < len(sql) else ""

        if line_comment:
            if ch == "\n":
                line_comment = False
            i += 1
            continue
        if block_comment:
            if ch == "*" and nxt == "/":
                block_comment = False
                i += 2
            else:
                i += 1
            continue
        if dollar_tag is not None:
            if sql.startswith(dollar_tag, i):
                i += len(dollar_tag)
                dollar_tag = None
            else:
                i += 1
            continue
        if quote is not None:
            if ch == quote:
                if quote == "'" and nxt == "'":
                    i += 2
                    continue
                quote = None
            elif ch == "\\" and quote == "'":
                i += 2
                continue
            i += 1
            continue

        if ch == "-" and nxt == "-":
            line_comment = True
            i += 2
            continue
        if ch == "/" and nxt == "*":
            block_comment = True
            i += 2
            continue
        if ch in ("'", '"'):
            quote = ch
            i += 1
            continue
        if ch == "$":
            match = re.match(r"\$[A-Za-z_0-9]*\$", sql[i:])
            if match:
                dollar_tag = match.group(0)
                i += len(dollar_tag)
                continue
        if ch == ";":
            piece = sql[start:i + 1].strip()
            if piece and re.sub(r"--[^\n]*", "", piece).strip():
                statements.append(piece)
            start = i + 1
        i += 1

    tail = sql[start:].strip()
    if tail and re.sub(r"--[^\n]*", "", tail).strip():
        statements.append(tail)
    return statements


def normalize_statement(statement: str) -> str | None:
    cleaned = re.sub(r"^\s*(?:--[^\n]*\n|/\*.*?\*/\s*)+", "", statement, flags=re.DOTALL).strip()
    if not cleaned:
        return None
    if re.search(r"supabase_realtime|storage\.objects|pg_(?:cron|net)", cleaned, re.IGNORECASE):
        return None
    return cleaned


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("batch-*.json"):
        old.unlink()
    for old in OUT.glob("migration-*.sql"):
        old.unlink()

    all_statements: list[dict[str, str]] = []
    for path in sorted(MIGRATIONS.glob("*.sql")):
        transformed = strip_supabase_infrastructure(path.read_text())
        for index, statement in enumerate(split_sql(transformed), start=1):
            normalized = normalize_statement(statement)
            if normalized:
                all_statements.append({"source": path.name, "index": str(index), "sql": normalized})

    batches: list[list[dict[str, str]]] = []
    current: list[dict[str, str]] = []
    current_bytes = 0
    for item in all_statements:
        item_bytes = len(item["sql"].encode())
        if current and (len(current) >= BATCH_SIZE or current_bytes + item_bytes > MAX_BATCH_BYTES):
            batches.append(current)
            current = []
            current_bytes = 0
        current.append(item)
        current_bytes += item_bytes
    if current:
        batches.append(current)

    for batch_index, batch in enumerate(batches, start=1):
        payload = {
            "projectId": "quiet-heart-24036829",
            "databaseName": "neondb",
            "sqlStatements": [item["sql"] for item in batch],
        }
        (OUT / f"batch-{batch_index:03d}.json").write_text(json.dumps(payload, indent=2) + "\n")
        sql_text = "\n\n".join(
            f"-- SOURCE: {item['source']} statement {item['index']}\n{item['sql']}" for item in batch
        )
        (OUT / f"migration-{batch_index:03d}.sql").write_text(sql_text + "\n")

    manifest = {
        "source_migrations": len(list(MIGRATIONS.glob("*.sql"))),
        "transformed_statements": len(all_statements),
        "batches": len(batches),
        "batch_size_limit": BATCH_SIZE,
        "max_batch_bytes": MAX_BATCH_BYTES,
        "removed_constructs": ["Supabase Realtime publication statements", "Supabase Storage object policies", "pg_cron", "pg_net"],
        "auth_users_target": "neon_auth.user",
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
