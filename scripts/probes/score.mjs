import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { request, entities, insights, callCount } from '../../server/qloo.mjs';
import { seed, acts } from '../../server/schedule.mjs';
const review = JSON.parse(readFileSync('cache/probes/identity-review.json'));
const frozen = JSON.parse(readFileSync('cache/probes/frozen.json'));
if (!existsSync('cache/probes/genre-baseline.json') || !existsSync('cache/probes/narrowed-triplets.json')) throw new Error('Pre-score freezes required');
const confirmed = review.filter(r => r.status === 'confirmed' && acts(seed('acl-friday')).includes(r.act));
const ids = confirmed.map(r => r.entityId).sort();
const source = confirmed.find(r => r.act === frozen.protocol.source);
const pool = ids.filter(id => id !== source.entityId);
async function save(label, params, options = {}) {
  const path = `cache/probes/${label}.json`;
  if (existsSync(path)) return JSON.parse(readFileSync(path));
  const result = await request('/v2/insights', params, options);
  writeFileSync(path, JSON.stringify(result, null, 2));
  return result;
}
const full = await save('transport-full', insights(source.entityId, pool));
await save('transport-repeat', insights(source.entityId, pool), { bypass: true });
const sentinels = pool.slice(0, 2), rest = pool.slice(2), mid = Math.ceil(rest.length / 2);
await save('transport-subset-1', insights(source.entityId, [...sentinels, ...rest.slice(0, mid)]), { bypass: true });
await save('transport-subset-2', insights(source.entityId, [...sentinels, ...rest.slice(mid)]), { bypass: true });
const scored = entities(full).filter(e => Number.isFinite(e.query?.affinity)).sort((a, b) => a.query.affinity - b.query.affinity);
if (scored.length) {
  await save('transport-low', insights(source.entityId, [scored[0].entity_id]), { bypass: true });
  await save('transport-high', insights(source.entityId, [scored.at(-1).entity_id]), { bypass: true });
}
await save('transport-take51', insights(source.entityId, pool, { take: 51 }), { bypass: true });
await save('transport-post', insights(source.entityId, pool), { bypass: true, method: 'POST' });
await save('transport-page1', insights(source.entityId, pool, { take: 25, page: 1 }), { bypass: true });
await save('transport-page2', insights(source.entityId, pool, { take: 25, page: 2 }), { bypass: true });
const ordered = [...confirmed].sort((a, b) => {
  const schedule = frozen.seeds[0];
  return Math.max(...schedule.slots.filter(s => s.act === a.act).map(s => s.billing)) - Math.max(...schedule.slots.filter(s => s.act === b.act).map(s => s.billing)) || a.act.localeCompare(b.act);
});
const repeated = Array.from({ length: 10 }, (_, i) => ordered[Math.round(i * (ordered.length - 1) / 9)]);
writeFileSync('cache/probes/row-selection.json', JSON.stringify({ confirmed, repeated: repeated.map(r => r.act), city: repeated.map(r => r.act) }, null, 2));
for (let i = 0; i < confirmed.length; i++) {
  const act = confirmed[i];
  await save(`matrix-${i}`, insights(act.entityId, ids.filter(id => id !== act.entityId)));
}
for (let i = 0; i < repeated.length; i++) {
  const act = repeated[i];
  const params = insights(act.entityId, ids.filter(id => id !== act.entityId));
  await save(`repeat-${i}`, params, { bypass: true });
  await save(`austin-${i}`, { ...params, 'signal.location.query': 'Austin, Texas' }, { bypass: true });
  await save(`control-${i}`, { ...params, 'signal.location.query': frozen.protocol.controlCity }, { bypass: true });
  if (i < 5) await save(`austin-repeat-${i}`, { ...params, 'signal.location.query': 'Austin, Texas' }, { bypass: true });
}
console.log(JSON.stringify({ confirmed: confirmed.length, matrixRows: confirmed.length, calls: callCount() }));
