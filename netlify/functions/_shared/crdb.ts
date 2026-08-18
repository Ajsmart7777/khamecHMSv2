import { Client } from 'pg';

export function getCrdbClient() {
  const connectionString = process.env.CRDB_CONNECTION_STRING || process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('CRDB_CONNECTION_STRING is not configured');
  }
  return new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });
}
