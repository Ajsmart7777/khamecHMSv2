from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_cockroach_migrations as bcm

for path in sorted(bcm.MIGRATIONS.glob('*.sql')):
    for i, raw in enumerate(bcm.split_sql(path.read_text()), 1):
        if 'CREATE OR REPLACE FUNCTION public.mark_item_unavailable' in raw:
            out = bcm.transform_statement(raw)
            print(path.name, i)
            print(out)
            import re
            pattern = r"(SELECT\s+public\.write_audit_log\(\s*'[^']+'\s*,\s*'[^']+'\s*,\s*[^,]+::text\s*,\s*jsonb_build_object\(.*?\))\s*\);"
            match = re.search(pattern, out, flags=re.IGNORECASE | re.DOTALL)
            print('HAS_EXPLICIT_SUCCESS=', "'success'" in out[out.lower().find('write_audit_log'):])
            print('REGEX_MATCH=', bool(match))
            if match:
                print('REGEX_GROUP=', match.group(1))
            raise SystemExit(0)
raise SystemExit('not found')
