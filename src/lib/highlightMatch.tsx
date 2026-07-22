import React from 'react';

function lev(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const m = a.length, n = b.length;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/**
 * Highlight portions of `text` that match `query`, tolerant of small typos.
 * Returns React nodes with <mark> around matched ranges.
 */
export function highlightMatch(text: string, query: string): React.ReactNode {
  if (!text) return text;
  const q = (query ?? '').trim().toLowerCase();
  if (!q) return text;
  const lower = text.toLowerCase();
  const tokens = q.split(/\s+/).filter(Boolean).slice(0, 6);

  // Enumerate word positions in the target string
  const targetTokens: { text: string; start: number }[] = [];
  const re = /[a-z0-9]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(lower)) !== null) {
    targetTokens.push({ text: m[0], start: m.index });
  }

  const ranges: [number, number][] = [];
  for (const qt of tokens) {
    // 1) exact substring wins
    const i = lower.indexOf(qt);
    if (i >= 0) { ranges.push([i, i + qt.length]); continue; }
    // 2) fuzzy match against a whole target token (Levenshtein on prefix)
    const allowed = Math.max(1, Math.floor(qt.length / 3));
    let best: { start: number; end: number; d: number } | null = null;
    for (const tt of targetTokens) {
      const slice = tt.text.slice(0, Math.min(tt.text.length, qt.length + 2));
      const d = lev(qt, slice);
      if (d <= allowed && (!best || d < best.d)) {
        best = { start: tt.start, end: tt.start + tt.text.length, d };
      }
    }
    if (best) ranges.push([best.start, best.end]);
  }

  if (!ranges.length) return text;
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }

  const out: React.ReactNode[] = [];
  let cur = 0;
  merged.forEach(([s, e], i) => {
    if (cur < s) out.push(text.slice(cur, s));
    out.push(
      <mark key={i} className="bg-yellow-200 dark:bg-yellow-500/40 text-inherit rounded px-0.5">
        {text.slice(s, e)}
      </mark>
    );
    cur = e;
  });
  if (cur < text.length) out.push(text.slice(cur));
  return <>{out}</>;
}