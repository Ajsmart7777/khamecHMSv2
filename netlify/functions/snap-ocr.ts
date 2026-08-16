import { database, json, optionsResponse, readJson, verifyUser } from './_shared/auth.js';

const GATEWAY = 'https://ai.gateway.lovable.dev/v1/chat/completions';
const DEFAULT_MODEL = 'google/gemini-3.1-pro-preview';

type Body = { snap_id?: string };
type Snap = { id: string; photo_path: string; order_type: string; target_station: string | null };
type OcrLine = { text?: string; type?: string; qty?: number };
type OcrResult = { full_text?: string; confidence?: number; lines?: OcrLine[] };
type VisionResponse = { choices?: Array<{ message?: { content?: unknown } }> };
type OcrMatch = { query: string; type: string | null; qty: number; candidates: unknown };


export default async (request: Request) => {
  if (request.method === 'OPTIONS') return optionsResponse();
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const caller = await verifyUser(request);
  if (!caller) return json({ error: 'Unauthorized' }, 401);

  const sql = database();
  let snap: Snap | undefined;
  let model = DEFAULT_MODEL;
  try {
    const { snap_id } = await readJson<Body>(request);
    if (!snap_id) return json({ error: 'snap_id required' }, 400);

    const snapRows = await sql`select id, photo_path, order_type, target_station from public.snap_orders where id = ${snap_id}::uuid limit 1` as Snap[];
    snap = snapRows[0];
    if (!snap) return json({ error: 'snap not found' }, 404);

    const settingRows = await sql`select value from public.app_settings where key = 'ocr' limit 1` as Array<{ value: unknown }>;
    const settingValue = settingRows[0]?.value;
    model = typeof settingValue === 'object' && settingValue !== null && 'model' in settingValue && typeof settingValue.model === 'string' ? settingValue.model : DEFAULT_MODEL;
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) return fail(sql, snap.id, model, 'LOVABLE_API_KEY missing');

    const publicUrl = (process.env.R2_PUBLIC_URL || process.env.VITE_R2_PUBLIC_URL || '').replace(/\/+$/, '');
    if (!publicUrl) return fail(sql, snap.id, model, 'R2_PUBLIC_URL missing');
    const imageUrl = `${publicUrl}/visit-cards/${snap.photo_path.split('/').map(encodeURIComponent).join('/')}`;

    const aiResponse = await fetch(GATEWAY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'You are a medical OCR assistant. Read handwritten hospital notes and return strict JSON only.' },
          { role: 'user', content: [{ type: 'text', text: buildPrompt(snap.order_type) }, { type: 'image_url', image_url: { url: imageUrl } }] },
        ],
        temperature: 0,
      }),
    });
    if (!aiResponse.ok) return fail(sql, snap.id, model, `gateway ${aiResponse.status}: ${(await aiResponse.text()).slice(0, 500)}`);

    const aiJson = await aiResponse.json() as VisionResponse;
    const raw = aiJson.choices?.[0]?.message?.content ?? '';
    const parsed = parseJson(raw);
    if (!parsed) return fail(sql, snap.id, model, `unparseable model output: ${String(raw).slice(0, 300)}`);

    const lines = Array.isArray(parsed.lines) ? parsed.lines : [];
    const fullText = typeof parsed.full_text === 'string' ? parsed.full_text : lines.map((line) => line.text ?? '').join('\n');
    const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0.7;
    const matches: OcrMatch[] = [];
    for (const line of lines) {
      const query = String(line.text ?? '').trim();
      if (query.length < 2) continue;
      const candidates = await sql`select * from public.match_catalogue(${query}, 3)`;
      matches.push({ query, type: line.type ?? null, qty: line.qty ?? 1, candidates });
    }

    await sql`update public.snap_orders set ocr_status = 'done', ocr_text = ${fullText}, ocr_confidence = ${confidence}, ocr_model = ${model}, ocr_matches = ${JSON.stringify(matches)}::jsonb, ocr_error = null where id = ${snap.id}::uuid`;
    return json({ ok: true, model, lines: lines.length, matches: matches.length });
  } catch (error) {
    if (snap) await fail(sql, snap.id, model, error instanceof Error ? error.message : String(error));
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
};

async function fail(sql: ReturnType<typeof database>, id: string, model: string, message: string) {
  await sql`update public.snap_orders set ocr_status = 'failed', ocr_model = ${model}, ocr_error = ${message} where id = ${id}::uuid`;
  return json({ ok: false, error: message }, 200);
}

function buildPrompt(kind: string) {
  const hint = kind === 'prescription' ? 'Each line is a medicine: name, strength, dosage. Set type="medicine".' : kind === 'lab' ? 'Each line is a lab test name. Set type="test".' : kind === 'lab_result' ? 'Each line is a lab test result. Set type="result".' : 'Each line is a clinical action or item. Set type="note".';
  return `Read the attached hospital note image and return ONLY strict JSON with this shape:\n{"full_text": string, "confidence": number 0..1, "lines": [{"text": string, "type": string, "qty": number}]}\n${hint}\nInclude a numeric qty when written (default 1). Do not invent items. If the image is unreadable, return {"full_text":"","confidence":0,"lines":[]}.`;
}

function parseJson(value: unknown): OcrResult | null {
  if (typeof value !== 'string' || !value) return null;
  try {
    return JSON.parse(value) as OcrResult;
  } catch {
    const match = value.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as OcrResult;
    } catch {
      return null;
    }
  }
}
