const targets = [
  ['clone-netlify-function', 'https://khameccockroach.netlify.app/.netlify/functions/flutterwave-webhook'],
  ['primary-supabase-function', 'https://gucnrzlfzyiyvpuugqgj.supabase.co/functions/v1/flutterwave-webhook'],
];

const payload = JSON.stringify({
  event: 'transfer.completed',
  data: { reference: 'NON_EXISTENT_READ_ONLY_CHECK', id: 'NON_EXISTENT_TRANSFER', status: 'SUCCESSFUL' },
});

for (const [name, url] of targets) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'verif-hash': 'deliberately-invalid-test-hash' },
    body: payload,
  });
  const text = await response.text();
  console.log(JSON.stringify({ name, status: response.status, bodyPrefix: text.slice(0, 160) }));
}
