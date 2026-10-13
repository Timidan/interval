import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { request, insights, callCount } from '../../server/qloo.mjs';
const selection = JSON.parse(readFileSync('cache/probes/row-selection.json'));
// Explicit central-Tokyo coordinate replaces the gateway's Minato interpretation.
for (let i = 0; i < selection.city.length; i++) {
  const file = `cache/probes/control-point-${i}.json`; if (existsSync(file)) continue;
  const source = selection.confirmed.find(r => r.act === selection.city[i]);
  const result = await request('/v2/insights', insights(source.entityId, selection.confirmed.filter(r => r.act !== source.act).map(r => r.entityId), {
    'signal.location': 'POINT(139.6917 35.6895)', 'signal.location.radius': 10000,
  }), { bypass: true });
  writeFileSync(file, JSON.stringify(result, null, 2));
}
console.log(`City point fallback recorded; total Qloo calls: ${callCount()}`);
