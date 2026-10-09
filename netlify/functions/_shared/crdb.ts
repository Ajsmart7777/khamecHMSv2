import { Client, Pool, type ClientBase, type PoolClient } from 'pg';

let sharedPool: Pool | undefined;

// CockroachDB (24.3+) refuses to let row-level triggers modify rows that are
// being rewritten by a foreign-key cascade (SQLSTATE 27000: "trigger ...
// attempted to modify or filter a row in a cascade operation") unless this
// session variable is enabled. Deleting a patient cascades to visits, which
// SET NULLs visit_id on prescriptions, snap_orders, invoices, lab_requests,
// vitals, standing_orders and admissions — and those tables have BEFORE
// UPDATE triggers that stamp updated_at, so the whole delete aborted with
// that error. The same cascade runs behind "Reset patient history" and the
// clinical purge RPCs. Our triggers only write updated_at (never a key or FK
// column), so the constraint-violation risk this bypass exists for does not
// apply here. Docs: https://docs.cockroachlabs.com/docs/stable/set-vars
const CASCADE_TRIGGER_BYPASS = 'SET unsafe_allow_triggers_modifying_cascades = true';

/**
 * Applied once per new connection. Never rejects: a failure here must not
 * break the connection, worst case the original CRDB error resurfaces.
 */
async function allowCascadeTriggerWrites(client: ClientBase) {
  try {
    await client.query(CASCADE_TRIGGER_BYPASS);
  } catch (error) {
    console.warn('Could not enable unsafe_allow_triggers_modifying_cascades', error);
  }
}

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
  const client = new Client({
    connectionString: getConnectionString(),
    ssl: { rejectUnauthorized: false }
  });
  // 'connect' fires synchronously before `await client.connect()` continuations
  // run, so this SET is queued ahead of the caller's first query.
  client.on('connect', () => { void allowCascadeTriggerWrites(client); });
  return client;
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
      // pg-pool awaits this hook before handing a brand-new connection to any
      // query, so every session has the bypass set before its first statement.
      onConnect: (client) => allowCascadeTriggerWrites(client),
    });
  }
  return sharedPool;
}

export type CrdbPoolClient = PoolClient;
