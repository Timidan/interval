import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { request, requestRef, cached, insights, entities, hash } from './qloo.mjs';
import { chunks, weightsFromRows } from './matrix.mjs';
import { pairKey } from './schedule.mjs';

export function candidateList(result) {
  return entities(result).filter(e => e.types?.includes('urn:entity:artist')).map(e => ({ ref: hash([result.ref, e.entity_id]), entityId: e.entity_id, name: e.name,
    description: e.properties?.short_description || '', genres: (e.tags || []).filter(t => t.type === 'urn:tag:genre').map(t => t.name), external: e.properties?.external || {} }));
}
export function plannedRequests(identities) {
  const confirmed = identities.filter(i => i.status === 'confirmed');
  return confirmed.flatMap(source => chunks(confirmed.filter(i => i.entityId !== source.entityId).map(i => i.entityId).sort()).filter(c => c.length).map(ids => ({ source, ids, params: insights(source.entityId, ids) })));
}
export function estimate(identities) {
  return plannedRequests(identities).filter(r => !cached(requestRef('/v2/insights', r.params))).length;
}
function quality(values) {
  const sorted = Object.values(values).sort((a, b) => a - b);
  const quantile = p => { const x = (sorted.length - 1) * p, a = sorted[Math.floor(x)], b = sorted[Math.ceil(x)]; return a + (b - a) * (x % 1); };
  const spread = sorted.length ? quantile(.9) - quantile(.1) : 0;
  const distinct = new Set(sorted).size;
  return { distinct, spread, usable: distinct >= 10 && spread > .0001 };
}
export async function buildSnapshot(identities, scope, progress = () => {}) {
  const confirmed = identities.filter(i => i.status === 'confirmed'), byId = Object.fromEntries(confirmed.map(i => [i.entityId, i.act]));
  if (new Set(confirmed.map(i => i.entityId)).size !== confirmed.length) throw new Error('Two acts share one confirmed identity; review identities');
  const rows = Object.fromEntries(confirmed.map(i => [i.act, { values: {}, observations: {}, requests: [], omitted: [], errors: [] }]));
  const planned = plannedRequests(identities); let completed = 0;
  for (const { source, ids, params } of planned) {
    const r = await request('/v2/insights', params), row = rows[source.act];
    row.requests.push({ ref: r.ref, method: 'GET', path: '/v2/insights', params, fetched: r.fetched, status: r.status });
    if (r.status !== 200) row.errors.push(`request failed (${r.status})`);
    else {
      const returned = new Set();
      for (const e of entities(r)) {
        if (!ids.includes(e.entity_id) || returned.has(e.entity_id)) { row.errors.push('unexpected or duplicate candidate'); continue; }
        returned.add(e.entity_id); const affinity = e.query?.affinity, act = byId[e.entity_id];
        if (!Number.isFinite(affinity) || affinity < 0 || affinity > 1) { row.errors.push('invalid affinity'); continue; }
        if (row.values[act] != null && Math.abs(row.values[act] - affinity) > .0001) row.errors.push('sentinel scores disagree across chunks');
        row.values[act] = affinity; row.observations[act] = { affinity, ref: r.ref, fetched: r.fetched };
      }
      row.omitted.push(...ids.filter(id => !returned.has(id)).map(id => byId[id]));
    }
    progress({ completed: ++completed, total: planned.length });
  }
  for (const row of Object.values(rows)) {
    row.quality = quality(row.values); if (row.errors.length) row.quality.usable = false;
    row.omitted = [...new Set(row.omitted)].filter(name => !(name in row.values));
  }
  const { ranks, weights } = weightsFromRows(Object.fromEntries(Object.entries(rows).map(([act, row]) => [act, row.values])), Object.keys(rows).filter(act => rows[act].quality.usable));
  const fetched = Object.values(rows).flatMap(row => row.requests.map(r => Date.parse(r.fetched)));
  const snapshot = { id: hash({ confirmed, rows }), fetchedAt: new Date(Math.max(...fetched)).toISOString(), context: 'global', scope, rows, ranks, weights,
    identities: confirmed, quality: confirmed.length === identities.length && Object.keys(weights).length === confirmed.length * (confirmed.length - 1) / 2 ? 'complete' : 'partial',
    gates: ['ACL transport and repeatability verified; per-row discrimination enforced', 'Full-seed identity coverage failed; operator and LLM comparisons pending', 'Additional lineups have not passed a frozen triplet experiment'] };
  return snapshot;
}
export function snapshotSummary(snapshot) {
  if (!snapshot) return null;
  const { id, fetchedAt, context, scope, quality, gates } = snapshot; return { id, fetchedAt, context, scope, quality, gates };
}
export function saveSnapshot(name, snapshot) {
  mkdirSync('cache/snapshots', { recursive: true, mode: 0o700 });
  writeFileSync(`cache/snapshots/${name}.json`, JSON.stringify(snapshot));
}
export function loadSnapshot(name) {
  const path = `cache/snapshots/${name}.json`;
  return existsSync(path) ? JSON.parse(readFileSync(path)) : null;
}
export const evidenceRef = (snapshot, a, b) => `pair-${hash([snapshot.id, ...[a, b].sort()]).slice(0, 24)}`;
export function evidence(snapshot, a, b) {
  return { ref: evidenceRef(snapshot, a, b), snapshotId: snapshot.id, acts: [a, b], weight: snapshot.weights[pairKey(a, b)] ?? null, threshold: .9,
    directions: [[a, b], [b, a]].map(([source, candidate]) => {
      const row = snapshot.rows[source], observation = row?.observations[candidate], req = row?.requests.find(r => r.ref === observation?.ref);
      return { source, candidate, affinity: observation?.affinity ?? null, percentile: snapshot.ranks[source]?.[candidate] ?? null,
        rowPopulation: Object.keys(row?.values || {}).length, row: Object.entries(row?.values || {}).map(([act, affinity]) => ({ act, affinity, percentile: snapshot.ranks[source]?.[act] ?? null })),
        reason: !row ? 'identity unconfirmed' : row.errors.length ? row.errors.join('; ') : !row.quality.usable ? 'row did not pass scoring checks' : !observation ? 'candidate was not returned' : undefined,
        request: req ? { method: req.method, path: req.path, params: req.params } : null, fetched: observation?.fetched ?? null };
    }) };
}
