import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { request, insights, entities, callCount } from '../../server/qloo.mjs';
const analysis = JSON.parse(readFileSync('cache/probes/analysis.json'));
const selection = JSON.parse(readFileSync('cache/probes/row-selection.json'));
const names = analysis.matrix.rowStats.filter(r => r.usable).map(r => r.act);
const confirmed = selection.confirmed.filter(r => names.includes(r.act));
const path = 'cache/probes/narrow-manifest.json';
if (!existsSync(path)) writeFileSync(path, JSON.stringify({ frozenAt: new Date().toISOString(), reason: 'Follow-up after full-scope coverage failure: remove unscoreable identities, retain the original scores and all failed gates', confirmed }, null, 2), { flag: 'wx' });
for (let i = 0; i < confirmed.length; i++) {
  const file = `cache/probes/narrow-${i}.json`;
  if (existsSync(file)) continue;
  const r = await request('/v2/insights', insights(confirmed[i].entityId, confirmed.filter((_, j) => j !== i).map(r => r.entityId)), { bypass: true });
  writeFileSync(file, JSON.stringify(r, null, 2));
}
const counts = confirmed.map((_, i) => entities(JSON.parse(readFileSync(`cache/probes/narrow-${i}.json`))).length);
console.log(JSON.stringify({ rows: confirmed.length, requested: confirmed.length * (confirmed.length - 1), returned: counts.reduce((a, b) => a + b, 0), calls: callCount() }));
