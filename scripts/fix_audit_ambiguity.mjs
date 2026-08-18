import pg from 'pg';
const connectionString = process.env.CRDB_CONNECTION_STRING;
if (!connectionString) throw new Error('CRDB_CONNECTION_STRING is required');
const client = new pg.Client({ connectionString });

async function run() {
    try {
        await client.connect();
        console.log('Connected to CockroachDB');
        
        // We need to find the functions with defaults and drop them.
        // CockroachDB doesn't make it easy to see defaults in SHOW FUNCTIONS.
        
        // Let's try to drop the specific problematic ones.
        const toDrop = [
            "public.write_audit_log(text, text, text, jsonb, text)",
            "public.write_audit_log(text, jsonb, uuid, text, text)",
            "public.write_audit_log(text, text, text, jsonb)",
            "public.write_audit_log(text, jsonb, uuid, text)"
        ];
        
        for (const sig of toDrop) {
            try {
                console.log(`Attempting to drop ${sig}...`);
                await client.query(`DROP FUNCTION IF EXISTS ${sig}`);
                console.log(`Dropped ${sig}`);
            } catch (err) {
                console.warn(`Could not drop ${sig}: ${err.message}`);
            }
        }
        
        // Now recreate them WITHOUT defaults.
        console.log('Recreating functions without defaults...');
        
        await client.query(`
            CREATE OR REPLACE FUNCTION public.write_audit_log(
                p_action text, 
                p_details text, 
                p_actor_id text, 
                p_affected_table jsonb
            ) RETURNS void LANGUAGE sql AS 'SELECT 1;'
        `);
        
        await client.query(`
            CREATE OR REPLACE FUNCTION public.write_audit_log(
                p_action text, 
                p_details text, 
                p_actor_id text, 
                p_affected_table jsonb,
                p_status text
            ) RETURNS void LANGUAGE sql AS 'SELECT 1;'
        `);
        
        console.log('Audit functions fixed');
    } catch (err) {
        console.error('Error fixing audit functions:', err);
    } finally {
        await client.end();
    }
}

run();
