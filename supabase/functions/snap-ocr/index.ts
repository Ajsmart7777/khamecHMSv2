import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const GATEWAY = 'https://ai.gateway.lovable.dev/v1/chat/completions';
const DEFAULT_MODEL = 'google/gemini-3.1-pro-preview';

interface Body { snap_id: string }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { snap_id } = (await req.json()) as Body;
    if (!snap_id) return json({ error: 'snap_id required' }, 400);

    const apiKey = Deno.env.get('LOVABLE_API_KEY');
    if (!apiKey) return json({ error: 'LOVABLE_API_KEY missing' }, 500);

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Load snap
    const { data: snap, error: snapErr } = await admin
      .from('snap_orders').select('id, photo_path, order_type, target_station').eq('id', snap_id).single();
    if (snapErr || !snap) return json({ error: snapErr?.message ?? 'snap not found' }, 404);

    // Load model setting
    const { data: setting } = await admin.from('app_settings').select('value').eq('key', 'ocr').maybeSingle();
    const model = (setting?.value as any)?.model ?? DEFAULT_MODEL;

    // Image URL: public R2 domain when configured, otherwise a Supabase signed URL
    const r2Public = Deno.env.get('R2_PUBLIC_URL')?.replace(/\/+$/, '');
    let imageUrl: string;
    if (r2Public) {
      imageUrl = `${r2Public}/visit-cards/${snap.photo_path.split('/').map(encodeURIComponent).join('/')}`;
    } else {
      const { data: signed, error: urlErr } = await admin.storage
        .from('visit-cards').createSignedUrl(snap.photo_path, 600);
      if (urlErr || !signed) return await fail(admin, snap_id, model, `image url: ${urlErr?.message ?? 'unknown'}`);
      imageUrl = signed.signedUrl;
    }

    const kind = snap.order_type; // 'prescription' | 'lab' | 'treatment' | 'lab_result'
    const prompt = buildPrompt(kind);

    // Call Lovable AI Gateway (vision)
    const aiRes = await fetch(GATEWAY, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'You are a medical OCR assistant. Read handwritten hospital notes and return strict JSON only.' },
          { role: 'user', content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: signed.signedUrl } },
          ]},
        ],
        temperature: 0,
      }),
    });

    if (!aiRes.ok) {
      const body = await aiRes.text();
      return await fail(admin, snap_id, model, `gateway ${aiRes.status}: ${body.slice(0, 500)}`);
    }
    const aiJson = await aiRes.json();
    const raw = aiJson?.choices?.[0]?.message?.content ?? '';
    const parsed = parseJson(raw);
    if (!parsed) return await fail(admin, snap_id, model, `unparseable model output: ${String(raw).slice(0, 300)}`);

    const lines: Array<{ text: string; type?: string; qty?: number }> = Array.isArray(parsed.lines) ? parsed.lines : [];
    const fullText: string = parsed.full_text ?? lines.map(l => l.text).join('\n');
    const confidence: number = typeof parsed.confidence === 'number' ? parsed.confidence : 0.7;

    // Fuzzy-match each line
    const matches: any[] = [];
    for (const line of lines) {
      const q = (line.text ?? '').trim();
      if (q.length < 2) continue;
      const { data: rows } = await admin.rpc('match_catalogue', { _query: q, _limit: 3 });
      matches.push({
        query: q,
        type: line.type ?? null,
        qty: line.qty ?? 1,
        candidates: rows ?? [],
      });
    }

    await admin.from('snap_orders').update({
      ocr_status: 'done',
      ocr_text: fullText,
      ocr_confidence: confidence,
      ocr_model: model,
      ocr_matches: matches,
      ocr_error: null,
    }).eq('id', snap_id);

    return json({ ok: true, model, lines: lines.length, matches: matches.length });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

async function fail(admin: any, id: string, model: string, msg: string) {
  await admin.from('snap_orders').update({ ocr_status: 'failed', ocr_model: model, ocr_error: msg }).eq('id', id);
  return json({ ok: false, error: msg }, 200);
}

function buildPrompt(kind: string): string {
  const hint =
    kind === 'prescription' ? 'Each line is a medicine: name, strength, dosage. Set type="medicine".'
    : kind === 'lab' ? 'Each line is a lab test name. Set type="test".'
    : kind === 'lab_result' ? 'Each line is a lab test result. Set type="result".'
    : 'Each line is a clinical action or item. Set type="note".';
  return `Read the attached hospital note image and return ONLY strict JSON with this shape:
{"full_text": string, "confidence": number 0..1, "lines": [{"text": string, "type": string, "qty": number}]}
${hint}
Include a numeric qty when written (default 1). Do not invent items. If the image is unreadable, return {"full_text":"","confidence":0,"lines":[]}.`;
}

function parseJson(s: string): any | null {
  if (!s) return null;
  try { return JSON.parse(s); } catch {}
  const m = s.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}