from __future__ import annotations

import json
from pathlib import Path

path = Path('/home/ubuntu/medflow-connect-neon/generated/neon-resume/batch-009.json')
data = json.loads(path.read_text())
original = len(data['sqlStatements'])
data['sqlStatements'] = [
    statement for statement in data['sqlStatements']
    if 'cron.' not in statement.lower() and 'net.http' not in statement.lower()
]
path.write_text(json.dumps(data, indent=2) + '\n')
print(json.dumps({'original_statements': original, 'remaining_statements': len(data['sqlStatements']), 'removed': original - len(data['sqlStatements'])}, indent=2))
