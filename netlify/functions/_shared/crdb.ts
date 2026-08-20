import { Client, Pool, type PoolClient } from 'pg';

let sharedPool: Pool | undefined;

function getConnectionString() {
  const connectionString = process.env.CRDB_CONNECTION_STRING || process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('CRDB_CONNECTION_STRING is not configured');
  }
  return connectionString;
}

/**
 * A fresh Client is retained for legacy functions that explicitly connect and
 * close within one invocation. The gateway uses getCrdbPool() so warm Netlify
 * invocations can reuse established CockroachDB connections.
 */
export function getCrdbClient() {
  return new Client({
    connectionString: getConnectionString(),
    ssl: { rejectUnauthorized: false }
  });
}

export function getCrdbPool(): Pool {
  if (!sharedPool) {
    sharedPool = new Pool({
      connectionString: getConnectionString(),
      ssl: { rejectUnauthorized: false },
      max: 4,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 8_000,
      keepAlive: true,
    });
  }
  return sharedPool;
}

export type CrdbPoolClient = PoolClient;
