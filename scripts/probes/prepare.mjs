import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { seed, acts, bottomHalf, neighbours, validate, solve, pairKey, metrics } from '../../server/schedule.mjs';
import { genres, triplets, protocol } from './frozen.mjs';
mkdirSync('cache/probes', { recursive: true, mode: 0o700 });
const manifest = { protocol, genres, triplets, seeds: ['acl-friday', 'iii-friday', 'iii-saturday'].map(id => seed(id)),
  hashes: Object.fromEntries(['seeds/acl-2026-w1-fri.csv', 'seeds/iii-points-2026.csv', 'scripts/probes/frozen.mjs', 'server/schedule.mjs'].map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')])) };
if (!existsSync('cache/probes/frozen.json')) writeFileSync('cache/probes/frozen.json', JSON.stringify({ ...manifest, frozenAt: new Date().toISOString() }, null, 2), { flag: 'wx' });
const probe0 = [];
for (const schedule of manifest.seeds) {
  const names = acts(schedule); let legal = 0, example;
  for (const slots of neighbours(schedule, schedule.slots)) if (!validate(schedule, slots, {}, { unknown: false }).length) { legal++; example ??= slots.filter((s, i) => s.start !== schedule.slots[i].start || s.stage !== schedule.slots[i].stage).map(s => s.act); }
  const patterns = [];
  for (let p = 0; p < 3; p++) {
    const weights = {};
    for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) weights[pairKey(names[i], names[j])] = ((i * 17 + j * 31 + p * 7) % 11 < 2) ? .95 : .2;
    const result = solve(schedule, weights, { unknown: false });
    patterns.push({ pattern: p, before: metrics(schedule.slots, weights), after: result.repairs[0]?.metrics ?? metrics(schedule.slots, weights), evaluated: result.evaluated });
  }
  probe0.push({ seed: schedule.id, sets: schedule.slots.length, acts: names.length, bottomHalf: bottomHalf(schedule), legalMoves: legal, example, patterns });
}
writeFileSync('cache/probes/probe0.json', JSON.stringify(probe0, null, 2));
console.log(JSON.stringify(probe0, null, 2));
