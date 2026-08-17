import { Client } from 'pg';

export function getCrdbClient() {
  const connectionString = process.env.CRDB_CONNECTION_STRING || process.env.DATABASE_URL || 'postgresql://dev_walid:ys6IqAgYSTXN4XlmvWIVXw@swell-gorgon-32055.j77.aws-eu-central-1.cockroachlabs.cloud:26257/khamec?sslmode=verify-full';
  return new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });
}
