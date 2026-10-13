import { readFileSync, writeFileSync } from 'node:fs';
import { acts, seed } from '../../server/schedule.mjs';
import { request, entities, callCount } from '../../server/qloo.mjs';
const existing = JSON.parse(readFileSync('cache/probes/identities.json'));
const results = [];
for (const name of acts(seed('iii-saturday'))) {
  const previous = existing.find(r => r.name.toLowerCase() === name.toLowerCase());
  if (previous) results.push({ ...previous, name });
  else {
    const result = await request('/search', { query: name, types: 'urn:entity:artist', take: 5 });
    results.push({ name, ref: result.ref, status: result.status, candidates: entities(result) });
  }
  writeFileSync('cache/probes/saturday-identities.json', JSON.stringify(results, null, 2));
}
console.log(JSON.stringify({ saturdaySearched: results.length, calls: callCount() }));
