import { readFileSync, writeFileSync } from 'node:fs';
import { entities, callCount } from '../../server/qloo.mjs';
import { acts, bottomHalf, seed, metrics, solve, validate, same } from '../../server/schedule.mjs';
import { percentiles, weightsFromRows } from '../../server/matrix.mjs';
const read = name => JSON.parse(readFileSync(`cache/probes/${name}.json`));
const frozen = read('frozen'), selection = read('row-selection'), review = read('identity-review');
const names = Object.fromEntries(selection.confirmed.map(r => [r.entityId, r.act]));
const scores = result => Object.fromEntries(entities(result).filter(e => names[e.entity_id] && Number.isFinite(e.query?.affinity) && e.query.affinity >= 0 && e.query.affinity <= 1).map(e => [names[e.entity_id], e.query.affinity]));
const q = (values, p) => { const v = [...values].sort((a, b) => a - b), x = (v.length - 1) * p; return v[Math.floor(x)] + (v[Math.ceil(x)] - v[Math.floor(x)]) * (x % 1); };
const diff = (a, b) => Math.max(0, ...Object.keys(a).filter(k => k in b).map(k => Math.abs(a[k] - b[k])));
function correlation(a, b) {
  const keys = Object.keys(a).filter(k => k in b), ra = percentiles(Object.fromEntries(keys.map(k => [k, a[k]]))), rb = percentiles(Object.fromEntries(keys.map(k => [k, b[k]])));
  if (keys.length < 2) return null;
  const meanA = keys.reduce((s, k) => s + ra[k], 0) / keys.length, meanB = keys.reduce((s, k) => s + rb[k], 0) / keys.length;
  const numerator = keys.reduce((s, k) => s + (ra[k] - meanA) * (rb[k] - meanB), 0);
  const denominator = Math.sqrt(keys.reduce((s, k) => s + (ra[k] - meanA) ** 2, 0) * keys.reduce((s, k) => s + (rb[k] - meanB) ** 2, 0));
  return denominator ? numerator / denominator : null;
}
const fullResult = read('transport-full'), full = scores(fullResult);
const transport = { candidates: fullResult.request.params['filter.results.entities'].split(',').length, returned: Object.keys(full).length, status: fullResult.status,
  omitted: fullResult.request.params['filter.results.entities'].split(',').filter(id => !entities(fullResult).some(e => e.entity_id === id)).map(id => names[id]),
  unexpected: entities(fullResult).filter(e => !fullResult.request.params['filter.results.entities'].split(',').includes(e.entity_id)).length,
  duplicates: entities(fullResult).length - new Set(entities(fullResult).map(e => e.entity_id)).size,
  comparisons: Object.fromEntries(['repeat', 'subset-1', 'subset-2', 'low', 'high', 'take51', 'post'].map(label => { const r = read(`transport-${label}`); const s = scores(r); return [label, { status: r.status, returned: Object.keys(s).length, common: Object.keys(s).filter(k => k in full).length, maxDifference: diff(full, s), sameIds: Object.keys(full).sort().join() === Object.keys(s).sort().join() }]; })),
};
const pages = [...entities(read('transport-page1')), ...entities(read('transport-page2'))].map(e => e.entity_id);
transport.pagination = { returned: pages.length, duplicates: pages.length - new Set(pages).size, sameIds: [...pages].sort().join() === entities(fullResult).map(e => e.entity_id).sort().join(), pageCounts: [entities(read('transport-page1')).length, entities(read('transport-page2')).length] };
const identity = ['acl-friday', 'iii-friday'].map(id => {
  const schedule = seed(id), all = acts(schedule), bottom = bottomHalf(schedule), confirmed = review.filter(r => r.status === 'confirmed' && all.includes(r.act)).map(r => r.act);
  return { seed: id, total: all.length, confirmed: confirmed.length, firstQuery: confirmed.filter(n => n !== 'Jesse Welles').length, bottomTotal: bottom.length, bottomConfirmed: bottom.filter(n => confirmed.includes(n)).length, unresolved: all.filter(n => !confirmed.includes(n)), ambiguous: review.filter(r => r.status === 'ambiguous' && all.includes(r.act)).map(r => r.act) };
});
const rows = Object.fromEntries(selection.confirmed.map((r, i) => [r.act, scores(read(`matrix-${i}`))]));
const repeats = selection.repeated.map((name, i) => ({ act: name, common: Object.keys(rows[name]).filter(n => n in scores(read(`repeat-${i}`))).length, noise: diff(rows[name], scores(read(`repeat-${i}`))), correlation: correlation(rows[name], scores(read(`repeat-${i}`))) }));
const noise = Math.max(...repeats.map(r => r.noise));
const rowStats = Object.entries(rows).map(([act, row]) => { const values = Object.values(row), spread = values.length ? q(values, .9) - q(values, .1) : 0; return { act, returned: values.length, requested: selection.confirmed.length - 1, omitted: selection.confirmed.filter(r => r.act !== act && !(r.act in row)).map(r => r.act), distinct: new Set(values).size, spread, usable: new Set(values).size >= 10 && spread > Math.max(.0001, 5 * noise) }; });
const triplets = list => list.map(([source, same, cross]) => ({ source, same, cross, result: rows[source]?.[same] == null || rows[source]?.[cross] == null ? 'unknown' : rows[source][same] > rows[source][cross] ? 'pass' : 'fail' }));
const originalTriplets = triplets(frozen.triplets), narrowTriplets = triplets(read('narrowed-triplets').triplets);
const directions = [];
for (const a of Object.keys(rows)) for (const b of Object.keys(rows).filter(b => b > a)) if (rows[a][b] != null && rows[b]?.[a] != null) directions.push(Math.abs(rows[a][b] - rows[b][a]));
const matrix = { requested: selection.confirmed.length * (selection.confirmed.length - 1), returned: rowStats.reduce((n, r) => n + r.returned, 0), usableRows: rowStats.filter(r => r.usable).length, totalRows: rowStats.length, noise, repeats, rowStats, originalTriplets, narrowTriplets, reciprocal: { pairs: directions.length, maxDifference: Math.max(...directions), meanDifference: directions.reduce((a, b) => a + b, 0) / directions.length } };
function changes(a, b) {
  const common = Object.keys(a).filter(k => k in b);
  const top = row => common.sort((x, y) => row[y] - row[x] || x.localeCompare(y)).slice(0, 10);
  const ta = top(a), tb = top(b); return ta.filter(n => !tb.includes(n)).length;
}
const city = selection.city.map((act, i) => {
  const a = read(`austin-${i}`), c = read(`control-${i}`), ar = scores(a), cr = scores(c);
  return { act, returned: Object.keys(ar).length, requested: selection.confirmed.length - 1,
    locality: a.data?.query?.localities?.signal?.disambiguation, correct: a.data?.query?.localities?.signal?.name === 'Austin' && a.data?.query?.localities?.signal?.disambiguation?.includes('Texas'),
    controlLocality: c.data?.query?.localities?.signal?.disambiguation, controlReturned: Object.keys(cr).length,
    topTenReplacements: changes(rows[act], ar), controlTopTenReplacements: changes(rows[act], cr),
    rankCorrelation: correlation(rows[act], ar), controlCorrelation: correlation(ar, cr),
    repeatCorrelation: i < 5 ? correlation(ar, scores(read(`austin-repeat-${i}`))) : null };
});
const usable = rowStats.filter(r => r.usable).map(r => r.act);
const { weights, ranks } = weightsFromRows(rows, usable);
const schedule = structuredClone(frozen.seeds[0]);
for (const s of schedule.slots) if (!selection.confirmed.some(r => r.act === s.act)) s.unresolved = true;
const solved = solve(schedule, weights), genre = read('genre-baseline');
const genreSlots = genre.repairs[0]?.slots ?? schedule.slots;
const best = solved.repairs[0]?.slots ?? schedule.slots;
const baseline = { original: metrics(schedule.slots, weights), interval: metrics(best, weights),
  intervalChanges: best.filter((s, i) => !same(s, schedule.slots[i])).map(s => s.act),
  intervalValidity: validate(schedule, best, weights), genre: metrics(genreSlots, weights), genreValidity: validate(schedule, genreSlots, weights),
  genreChanges: genreSlots.filter((s, i) => !same(s, schedule.slots[i])).map(s => s.act), proposals: solved.repairs.length, evaluated: solved.evaluated,
  llm: 'pending', operator: 'pending' };
const analysis = { transport, identity, matrix, city, baseline, calls: callCount() };
writeFileSync('cache/probes/analysis.json', JSON.stringify(analysis, null, 2));
writeFileSync('cache/probes/acl-snapshot.json', JSON.stringify({ createdAt: new Date().toISOString(), identities: selection.confirmed, rows, ranks, weights, rowStats, repairs: solved.repairs }, null, 2));
console.log(JSON.stringify(analysis, null, 2));
