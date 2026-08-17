from pathlib import Path
import re

root = Path(__file__).resolve().parents[1] / 'supabase' / 'migrations'
for path in sorted(root.glob('*.sql')):
    text = path.read_text()
    for match in re.finditer(r'CREATE(?: OR REPLACE)? FUNCTION\s+([\w.]+)\s*\([^)]*\).*?\bDECLARE\b(.*?)\bBEGIN\b', text, flags=re.I | re.S):
        function = match.group(1)
        declare = match.group(2)
        variables = re.findall(r'\b([A-Za-z_]\w*)\s+RECORD\b', declare, flags=re.I)
        if not variables:
            continue
        body = text[match.start():]
        next_func = re.search(r'\nCREATE(?: OR REPLACE)? FUNCTION\b', body[1:], flags=re.I)
        if next_func:
            body = body[:next_func.start() + 1]
        mappings = {}
        for var in variables:
            tables = sorted(set(re.findall(rf'\bINTO\s+{re.escape(var)}\b[\s\S]{{0,500}}?\bFROM\s+([\w.]+)', body, flags=re.I)))
            mappings[var] = tables
        print(f'{path.name}\t{function}\t{mappings}')
