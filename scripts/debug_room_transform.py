from pathlib import Path
import importlib.util

spec = importlib.util.spec_from_file_location('builder', Path(__file__).with_name('build_cockroach_migrations.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
for path in sorted(Path('/home/ubuntu/medflow-connect/supabase/migrations').glob('*.sql')):
    for index, statement in enumerate(module.split_sql(path.read_text()), 1):
        if 'bill_admission_bed_days' in statement:
            print('SOURCE', path.name, index)
            print(statement)
            transformed = module.transform_statement(statement)
            print('TRANSFORMED')
            print(transformed)
            raise SystemExit(0)
raise SystemExit('function not found')
