import pg from 'pg';
const client = new pg.Client({
    connectionString: 'postgresql://dev_walid:ys6IqAgYSTXN4XlmvWIVXw@swell-gorgon-32055.j77.aws-eu-central-1.cockroachlabs.cloud:26257/khamec?sslmode=verify-full'
});

async function run() {
    try {
        await client.connect();
        console.log('Connected to CockroachDB');
        
        // Ensure password column exists
        await client.query("ALTER TABLE public.auth_users ADD COLUMN IF NOT EXISTS password TEXT");
        
        const adminId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
        const email = 'admin@gmail.com';
        const password = 'admin123';
        
        // Delete if exists to be sure
        await client.query("DELETE FROM public.auth_users WHERE email = $1", [email]);
        
        // Insert admin user
        await client.query(
            "INSERT INTO public.auth_users (id, email, password) VALUES ($1, $2, $3)",
            [adminId, email, password]
        );
        
        // Ensure user_roles has the role
        await client.query("DELETE FROM public.user_roles WHERE user_id = $1", [adminId]);
        await client.query(
            "INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'admin')",
            [adminId]
        );
        
        console.log('Admin user configured successfully');
    } catch (err) {
        console.error('Error configuring admin:', err);
    } finally {
        await client.end();
    }
}

run();
