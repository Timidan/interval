import { writeFileSync } from 'node:fs';
import { seed, acts } from '../../server/schedule.mjs';
import { request, entities, callCount } from '../../server/qloo.mjs';
const names = [...new Set([...acts(seed('acl-friday')), ...acts(seed('iii-friday'))])];
const results = [];
for (const name of names) {
  const result = await request('/search', { query: name, types: 'urn:entity:artist', take: 5 });
  results.push({ name, ref: result.ref, status: result.status, candidates: entities(result) });
  writeFileSync('cache/probes/identities.json', JSON.stringify(results, null, 2));
}
const controls = [];
for (const types of [null, 'urn:entity:artist', 'urn:entity:tv_show']) controls.push(await request('/search', { query: 'Wednesday', take: 5, ...(types ? { types } : {}) }));
writeFileSync('cache/probes/search-controls.json', JSON.stringify(controls, null, 2));
console.log(JSON.stringify({ searched: results.length, nonempty: results.filter(r => r.candidates.length).length, calls: callCount() }));
