import { readFileSync, writeFileSync } from 'node:fs';
import { request, entities, callCount } from '../../server/qloo.mjs';
const rows = JSON.parse(readFileSync('cache/probes/identities.json'));
for (const [name, query] of [['Jesse Welles', 'Welles'], ['Solomon Hicks', 'King Solomon Hicks'], ['The 4411', '4411']]) {
  const row = rows.find(r => r.name === name);
  const result = await request('/search', { query, types: 'urn:entity:artist', take: 5 });
  row.retry = { query, ref: result.ref, status: result.status, candidates: entities(result) };
}
writeFileSync('cache/probes/identities.json', JSON.stringify(rows, null, 2));
console.log(JSON.stringify({ calls: callCount(), retries: rows.filter(r => r.retry).map(r => ({ name: r.name, candidates: r.retry.candidates.map(c => ({ name: c.name, description: c.properties?.short_description, genres: c.tags?.filter(t => t.type === 'urn:tag:genre').map(t => t.name) })) })) }));
