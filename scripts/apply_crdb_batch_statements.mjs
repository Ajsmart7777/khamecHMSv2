import fs from 'node:fs/promises';
import pg from 'pg';
const { Client } = pg;

function isFunctionPrivilegeStatement(sql) {
  return /^\s*(?:GRANT|REVOKE)\b[\s\S]*\bON\s+FUNCTION\b/i.test(sql);
}

function isMissingFunctionError(message) {
  return /(?:function|routine) .* does not exist/i.test(message)
    || /unknown function/i.test(message)
    || /undefined function/i.test(message);
}

function isFunctionDefinition(sql) {
  return /^\s*CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/i.test(sql);
}

async function main() {
  const password = process.env.CRDB_PASSWORD;
  const database = process.env.CRDB_DATABASE ?? 'khamec';
  const batchPath = process.argv[2];
  if (!password || !batchPath) throw new Error('CRDB_PASSWORD and batch JSON path are required');
  const payload = JSON.parse(await fs.readFile(batchPath, 'utf8'));
  const statements = payload.sqlStatements ?? [];
  const resume = process.env.CRDB_RESUME === '1';
  const client = new Client({
    host: 'swell-gorgon-32055.j77.aws-eu-central-1.cockroachlabs.cloud',
    port: 26257,
    user: 'dev_walid',
    password,
    database,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
    statement_timeout: 300000,
  });

  const deferred = [];
  const skipped = [];

  async function execute(index, sql, retry = false) {
    try {
      await client.query(sql);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const enumAlreadyExists = /enum value .* already exists/i.test(message);
      const duplicateOnResume = resume && (/(?:relation|table|index|constraint|policy|trigger|type|function) .* already exists/i.test(message) || /duplicate constraint name/i.test(message));
      if (enumAlreadyExists || duplicateOnResume) {
        const reason = enumAlreadyExists ? 'enum_value_already_exists' : 'duplicate_object_on_resume';
        skipped.push({ reason, batch: batchPath, statementIndex: index + 1, error: message });
        console.warn(JSON.stringify({ skipped: true, reason, batch: batchPath, statementIndex: index + 1, error: message }));
        return true;
      }
      if (!retry && (isFunctionPrivilegeStatement(sql) || isFunctionDefinition(sql)) && isMissingFunctionError(message)) {
        deferred.push({ index, sql, definition: isFunctionDefinition(sql) });
        console.warn(JSON.stringify({ deferred: true, reason: isFunctionDefinition(sql) ? 'function_dependency_not_created_yet' : 'function_not_created_yet', batch: batchPath, statementIndex: index + 1, error: message }));
        return true;
      }
      console.error(JSON.stringify({ applied: false, batch: batchPath, statementIndex: index + 1, statement: sql, error: message }, null, 2));
      throw error;
    }
  }

  try {
    await client.connect();
    for (let index = 0; index < statements.length; index += 1) {
      console.log(JSON.stringify({ executing: true, batch: batchPath, statementIndex: index + 1, total: statements.length }));
      await execute(index, statements[index]);
    }

    let pending = deferred.splice(0);
    let pass = 0;
    while (pending.length > 0) {
      pass += 1;
      const next = [];
      const ordered = pending.sort((a, b) => Number(b.definition) - Number(a.definition));
      for (const item of ordered) {
        try {
          await execute(item.index, item.sql, true);
        } catch (error) {
          if (item.definition && isMissingFunctionError(error instanceof Error ? error.message : String(error)) && pass < 10) {
            next.push(item);
          } else {
            throw error;
          }
        }
      }
      if (next.length === pending.length) {
        await execute(next[0].index, next[0].sql, true);
      }
      pending = next;
    }

    console.log(JSON.stringify({ applied: true, batch: batchPath, statements: statements.length, deferredRetried: deferred.length, dependencyPasses: pass }, null, 2));
  } finally {
    await client.end().catch(() => undefined);
  }
}

await main();
