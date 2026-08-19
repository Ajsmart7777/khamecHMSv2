import fs from 'node:fs';
import pg from 'pg';

const connectionString = process.env.CRDB_CONNECTION_STRING || fs.readFileSync('/home/ubuntu/.crdb_connection_string', 'utf8').trim();
const client = new pg.Client({ connectionString });

function num(value) {
  return Number(value ?? 0);
}

async function main() {
  await client.connect();
  try {
    const invoiceResult = await client.query(`
      SELECT i.id, i.invoice_number, i.patient_id, i.total_amount, i.paid_amount,
             i.status, COALESCE(p.balance, 0) AS patient_balance
      FROM public.invoices i
      JOIN public.patients p ON p.id = i.patient_id
      WHERE i.status IN ('pending', 'partial')
      ORDER BY i.created_at ASC
      LIMIT 1
    `);
    if (!invoiceResult.rows[0]) {
      console.log(JSON.stringify({ skipped: true, reason: 'No pending or partial invoice available' }));
      return;
    }
    const invoice = invoiceResult.rows[0];
    const outstanding = Math.max(num(invoice.total_amount) - num(invoice.paid_amount), 0);
    const auth = await client.query(`SELECT id FROM public.auth_users ORDER BY created_at ASC LIMIT 1`);
    const userId = auth.rows[0]?.id;
    if (!userId) throw new Error('No auth user available for rollback test');

    const scenarios = [
      { name: 'zero_credit', cash: 0, balance: 0, debt: outstanding, paymentMethod: 'cash' },
      { name: 'underpayment_debt', cash: Math.floor(outstanding / 2), balance: 0, debt: outstanding - Math.floor(outstanding / 2), paymentMethod: 'cash' },
      { name: 'exact_payment', cash: outstanding, balance: 0, debt: 0, paymentMethod: 'cash' },
      { name: 'overpayment_credit', cash: outstanding + 500, balance: 0, debt: 0, paymentMethod: 'cash' },
    ];
    const results = [];
    for (const scenario of scenarios) {
      await client.query('BEGIN');
      try {
        await client.query(`SELECT set_config('hms.user_id', $1, false), set_config('hms.user_role', 'admin', false)`, [userId]);
        const result = await client.query(`
          SELECT public.settle_invoice_atomic($1::UUID, $2::DECIMAL, $3::DECIMAL, $4::DECIMAL, $5::STRING, $6::STRING, false, false) AS result
        `, [
          invoice.id,
          scenario.cash,
          scenario.balance,
          scenario.debt,
          scenario.paymentMethod,
          `ROLLBACK settlement matrix ${scenario.name}`,
        ]);
        const body = result.rows[0]?.result;
        const after = await client.query(`SELECT status, paid_amount, COALESCE((SELECT balance FROM public.patients WHERE id = $1), 0) AS balance FROM public.invoices WHERE id = $2`, [invoice.patient_id, invoice.id]);
        results.push({
          scenario: scenario.name,
          ok: true,
          returned: body,
          inTransaction: after.rows[0],
        });
      } catch (error) {
        results.push({ scenario: scenario.name, ok: false, error: String(error?.message || error) });
      } finally {
        await client.query('ROLLBACK');
      }
    }
    console.log(JSON.stringify({
      invoice: { id: invoice.id, number: invoice.invoice_number, outstanding, initialBalance: num(invoice.patient_balance) },
      results,
      committedChanges: false,
    }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
