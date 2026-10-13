import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { acts, solve } from '../../server/schedule.mjs';
import { weightsFromRows } from '../../server/matrix.mjs';
const frozen = JSON.parse(readFileSync('cache/probes/frozen.json'));
const schedule = frozen.seeds[0], names = acts(schedule), rows = {};
for (const a of names) { rows[a] = {}; for (const b of names.filter(b => b !== a)) {
  const ga = frozen.genres[a], gb = frozen.genres[b];
  rows[a][b] = ga.filter(g => gb.includes(g)).length / new Set([...ga, ...gb]).size;
} }
if (existsSync('cache/probes/genre-baseline.json')) throw new Error('Genre baseline already frozen');
const { weights } = weightsFromRows(rows);
writeFileSync('cache/probes/genre-baseline.json', JSON.stringify({ frozenAt: new Date().toISOString(), rows, ...solve(schedule, weights) }, null, 2), { flag: 'wx' });
console.log('Genre-only repair frozen before Qloo scores');
