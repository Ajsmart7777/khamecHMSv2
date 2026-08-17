import pg from 'pg';

const { Client } = pg;
const client = new Client({
  host: process.env.CRDB_HOST || 'swell-gorgon-32055.j77.aws-eu-central-1.cockroachlabs.cloud',
  port: Number(process.env.CRDB_PORT || 26257),
  user: process.env.CRDB_USER || 'dev_walid',
  password: process.env.CRDB_PASSWORD,
  database: process.env.CRDB_DATABASE || 'khamec',
  ssl: { rejectUnauthorized: false },
});
await client.connect();
const variants = [
  `staff_id IN (SELECT id FROM public.staff WHERE public.staff.auth_user_id = public.hms_current_user_id())`,
  `EXISTS (SELECT 1 FROM public.staff WHERE public.staff.id = staff_family_members.staff_id AND public.staff.auth_user_id = public.hms_current_user_id())`,
  `staff_id IN (SELECT id FROM public.staff WHERE auth_user_id = public.hms_current_user_id())`,
];
try {
  for (let i = 0; i < variants.length; i += 1) {
    const name = `crdb_policy_probe_${i}`;
    await client.query(`DROP POLICY IF EXISTS ${name} ON public.staff_family_members`);
    try {
      await client.query(`CREATE POLICY ${name} ON public.staff_family_members FOR SELECT TO authenticated USING (${variants[i]})`);
      console.log(JSON.stringify({ index: i, ok: true, variant: variants[i] }));
    } catch (error) {
      console.log(JSON.stringify({ index: i, ok: false, variant: variants[i], code: error.code, message: error.message, detail: error.detail, hint: error.hint }));
    } finally {
      await client.query(`DROP POLICY IF EXISTS ${name} ON public.staff_family_members`);
    }
  }
} finally {
  await client.end();
}
