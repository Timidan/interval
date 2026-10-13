import { readFileSync } from 'node:fs';

export function csv(text) {
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (!quoted && (c === ',' || c === '\n')) { row.push(cell.replace(/\r$/, '')); cell = ''; if (c === '\n') { rows.push(row); row = []; } }
    else cell += c;
  }
  if (quoted) throw new Error('Unclosed CSV quote');
  if (cell || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row); }
  const header = rows.shift();
  return rows.filter(r => r.some(Boolean)).map(r => { if (r.length !== header.length) throw new Error('CSV column count mismatch'); return Object.fromEntries(header.map((h, i) => [h, r[i]])); });
}
export const minute = iso => Date.parse(iso + ':00Z') / 60000;
export const same = (a, b) => a.day === b.day && a.stage === b.stage && a.start === b.start;
const dayMinute = day => minute(`${day}T00:00`);
function bounds(slot, day) {
  const offset = dayMinute(day) - dayMinute(slot.day);
  return [Math.max(slot.earliest + offset, slot.notBefore == null ? -Infinity : dayMinute(day) + slot.notBefore),
    Math.min(slot.latestEnd + offset, slot.notAfter == null ? Infinity : dayMinute(day) + slot.notAfter)];
}
const tiers = {
  'T-Mobile': 1, 'American Express': 1, 'Miller Lite': 2, Snapchat: 2, "Tito's Handmade Vodka": 2,
  BMI: 3, Beatbox: 3, 'Bonus Tracks': 4,
  'Mind Melt': 1, 'Sector 3': 1, Isotropic: 2, RC95: 2, '444': 3, S3QUENC3: 3,
};
export function seed(id) {
  const acl = id === 'acl-friday';
  const rows = csv(readFileSync(acl ? 'seeds/acl-2026-w1-fri.csv' : 'seeds/iii-points-2026.csv', 'utf8'))
    .filter(r => acl ? r.stage !== 'Austin Kiddie Limits' : id === 'iii-points' || r.programme_day === (id === 'iii-friday' ? '2026-10-16' : '2026-10-17'));
  const slots = rows.map((r, i) => ({ id: `${id}-${i}`, act: r.act === 'Steve Aoki with Mack' ? 'Steve Aoki' : r.act,
    label: r.act, day: r.programme_day, stage: r.stage, start: minute(r.start_local), duration: minute(r.end_local) - minute(r.start_local),
    excluded: r.act === 'Silent Disco', unresolved: r.b2b === 'yes', locked: r.b2b === 'yes' || r.act === 'Silent Disco', tier: tiers[r.stage] || 4,
  }));
  const stages = [];
  for (const day of [...new Set(slots.map(s => s.day))]) for (const name of [...new Set(slots.filter(s => s.day === day).map(s => s.stage))]) {
    const group = slots.filter(s => s.day === day && s.stage === name).sort((a, b) => a.start - b.start);
    const billing = group.filter(s => !s.excluded);
    for (let i = 0; i < billing.length; i++) {
      const s = billing[i]; s.billing = billing.length === 1 ? 1 : i / (billing.length - 1);
      s.band = i === billing.length - 1 && s.tier === 1 ? 'headline' : i >= billing.length - 2 ? 'sub-headline' : i === 0 ? 'opener' : 'middle';
      if (s.band === 'headline') s.locked = true;
    }
    stages.push({ name, day, tier: group[0].tier, open: group[0].start, close: Math.max(...group.map(s => s.start + s.duration)),
      changeover: Math.min(...group.slice(1).map((s, i) => s.start - group[i].start - group[i].duration), 60) });
  }
  for (const s of slots) {
    const peers = slots.filter(t => t.day === s.day && t.tier === s.tier && t.band === s.band);
    s.earliest = Math.min(...peers.map(t => t.start)); s.latestEnd = Math.max(...peers.map(t => t.start + t.duration));
  }
  return { id, slots, stages, k: 4, buffer: 0, holds: 'Inferred holds, loosened to bands for this scenario' };
}
export function acts(schedule) {
  return [...new Set(schedule.slots.filter(s => !s.excluded && !s.unresolved).map(s => s.act))];
}
export function bottomHalf(schedule) {
  return acts(schedule).map(act => ({ act, billing: Math.max(...schedule.slots.filter(s => s.act === act).map(s => s.billing)), start: Math.min(...schedule.slots.filter(s => s.act === act).map(s => s.start)) }))
    .sort((a, b) => a.billing - b.billing || a.start - b.start || a.act.localeCompare(b.act)).slice(0, Math.ceil(acts(schedule).length / 2)).map(s => s.act);
}
export function overlap(a, b, buffer = 0) {
  return a.day !== b.day || a.stage === b.stage ? 0 : Math.min(a.duration, b.duration, Math.max(0, Math.min(a.start + a.duration, b.start + b.duration) - Math.max(a.start, b.start) + buffer));
}
export const pairKey = (a, b) => [a, b].sort().join('\u0000');
export function metrics(slots, weights, buffer = 0) {
  let cost = 0, strongClashes = 0, unknownClashes = 0, unknownMinutes = 0;
  for (let i = 0; i < slots.length; i++) for (let j = i + 1; j < slots.length; j++) {
    const a = slots[i], b = slots[j]; if (a.excluded || b.excluded || a.act === b.act) continue;
    const minutes = overlap(a, b, buffer), w = weights[pairKey(a.act, b.act)];
    if (w == null) { if (minutes > 0) { unknownClashes++; unknownMinutes += minutes; } }
    else if (w >= .9 && minutes > 0) { cost += w * minutes; strongClashes++; }
  }
  return { cost, strongClashes, unknownClashes, unknownMinutes, majorDrawMinutes: majorDrawMinutes(slots) };
}
export function validate(schedule, slots, weights, { unknown = true, unknownGuard = schedule.unknownGuard || 'pair', prepared } = {}) {
  if (!['pair', 'net'].includes(unknownGuard)) return ['invalid unknown guard'];
  const original = schedule.slots;
  const originals = prepared?.originals ?? new Map(original.map(s => [s.id, s]));
  if (slots.length !== original.length || new Set(slots.map(s => s.id)).size !== original.length) return ['set uniqueness'];
  let moved = 0;
  for (const s of slots) {
    const o = originals.get(s.id); if (!o || s.act !== o.act || s.duration !== o.duration) return ['set identity or duration'];
    if (!Number.isFinite(s.start)) return ['invalid start'];
    if (!same(s, o)) moved++;
    const held = o.holdPlacement || o;
    if ((o.locked && !same(s, held)) || (o.unresolved && !same(s, o))) return ['fixed set'];
    const [earliest, latestEnd] = bounds(o, s.day);
    if (!(o.allowedDays || [o.day]).includes(s.day) || s.start < earliest || s.start + s.duration > latestEnd) return ['availability or billing band'];
    if ((o.holds?.includes('day') && s.day !== held.day) || (o.holds?.includes('stage') && s.stage !== held.stage) || (o.holds?.includes('start') && s.start !== held.start)) return ['operator hold'];
    const stage = schedule.stages.find(t => t.day === s.day && t.name === s.stage);
    if (!stage || stage.tier !== o.tier || (o.allowedStages && !o.allowedStages.includes(s.stage)) || s.start < stage.open || s.start + s.duration > stage.close) return ['stage domain'];
  }
  if (moved > schedule.k) return ['move budget'];
  const bandOrder = { opener: 0, middle: 1, 'sub-headline': 2, headline: 3 };
  for (const stage of schedule.stages) {
    const group = slots.filter(s => s.stage === stage.name && s.day === stage.day).sort((a, b) => a.start - b.start);
    for (let i = 1; i < group.length; i++) {
      if (group[i].start < group[i - 1].start + group[i - 1].duration + stage.changeover) return ['stage overlap or changeover'];
      if (!group[i].excluded && !group[i - 1].excluded && bandOrder[group[i].band] < bandOrder[group[i - 1].band]) return ['billing precedence'];
    }
  }
  const protectedPairs = prepared?.protectedPairs ?? slots.flatMap((a, i) => slots.slice(i + 1).map((b, offset) => [i, i + 1 + offset]).filter(([, j]) => a.act === slots[j].act || (unknown && !a.excluded && !slots[j].excluded && weights[pairKey(a.act, slots[j].act)] == null)));
  let unknownDelta = 0;
  for (const [i, j] of protectedPairs) {
    const a = slots[i], b = slots[j];
    if (prepared && a.act !== b.act && same(a, original[i]) && same(b, original[j])) continue;
    if (a.act === b.act && overlap(a, b) > 0) return ['same performer overlap'];
    if (unknown && !a.excluded && !b.excluded && weights[pairKey(a.act, b.act)] == null) {
      const oa = originals.get(a.id), ob = originals.get(b.id);
      const delta = overlap(a, b, schedule.buffer) - overlap(oa, ob, schedule.buffer);
      if (unknownGuard === 'pair' && delta > 0) return ['unknown overlap increased'];
      unknownDelta += delta;
    }
  }
  if (unknown && unknownGuard === 'net' && unknownDelta > 0) return ['total unknown overlap increased'];
  return [];
}
export function* neighbours(schedule, slots) {
  const free = slots.filter(s => !s.locked && !s.unresolved);
  for (let i = 0; i < free.length; i++) for (let j = i + 1; j < free.length; j++) {
    const a = free[i], b = free[j];
    if (a.day === b.day && a.tier === b.tier && a.band === b.band && a.duration === b.duration) {
      yield slots.map(s => s.id === a.id ? { ...s, stage: b.stage, start: b.start } : s.id === b.id ? { ...s, stage: a.stage, start: a.start } : s);
    }
  }
  for (const a of free) for (const stage of schedule.stages.filter(s => (a.allowedDays || [a.day]).includes(s.day) && s.tier === a.tier)) {
    const original = schedule.slots.find(s => s.id === a.id), [earliest, latest] = bounds(original, stage.day);
    const alignedStart = a.start + dayMinute(stage.day) - dayMinute(a.day);
    const starts = new Set([alignedStart, alignedStart - 5, alignedStart + 5, stage.open, stage.close - a.duration, earliest, latest - a.duration]);
    for (const b of slots.filter(s => s.day === stage.day && s.stage === stage.name && s.id !== a.id)) {
      starts.add(b.start + b.duration + stage.changeover); starts.add(b.start - a.duration - stage.changeover);
    }
    for (const start of [...starts].sort((a, b) => a - b)) if (start !== a.start || stage.name !== a.stage || stage.day !== a.day) yield slots.map(s => s.id === a.id ? { ...s, day: stage.day, stage: stage.name, start } : s);
  }
}
export function solve(schedule, weights, { seed = 20261013, budget = 15000, unknown = true, unknownGuard = schedule.unknownGuard || 'pair', guardWeights = weights, startSlots = schedule.slots } = {}) {
  let rng = seed >>> 0, evaluated = 0; const archive = new Map();
  const random = () => { rng ^= rng << 13; rng ^= rng >>> 17; rng ^= rng << 5; return (rng >>> 0) / 4294967296; };
  const strong = [], protectedPairs = [];
  for (let i = 0; i < schedule.slots.length; i++) for (let j = i + 1; j < schedule.slots.length; j++) {
    const a = schedule.slots[i], b = schedule.slots[j];
    const w = weights[pairKey(a.act, b.act)];
    if (!a.excluded && !b.excluded && a.act !== b.act && w >= .9) strong.push([i, j, w]);
    if (a.act === b.act || (unknown && !a.excluded && !b.excluded && guardWeights[pairKey(a.act, b.act)] == null)) protectedPairs.push([i, j]);
  }
  const prepared = { originals: new Map(schedule.slots.map(s => [s.id, s])), protectedPairs };
  const lambda = { affinity: 0, balanced: .5, concurrent: 1 }[schedule.objective || 'affinity'];
  const maxCost = Math.max(1, strong.reduce((n, [i, j, w]) => n + w * Math.min(schedule.slots[i].duration, schedule.slots[j].duration), 0));
  const maxDraw = Math.max(1, schedule.slots.filter(s => s.majorDraw).reduce((n, s) => n + s.duration, 0));
  const rank = slots => [(1 - lambda) * strong.reduce((cost, [i, j, w]) => cost + w * overlap(slots[i], slots[j], schedule.buffer), 0) / maxCost + lambda * majorDrawMinutes(slots) / maxDraw, slots.filter((s, i) => !same(s, schedule.slots[i])).length,
    slots.reduce((n, s, i) => n + Math.abs(s.start - schedule.slots[i].start), 0), slots.filter((s, i) => s.stage !== schedule.slots[i].stage).length];
  const compare = (a, b) => { for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 1e-9) return a[i] - b[i]; return 0; };
  const base = rank(startSlots), invalidStart = validate(schedule, startSlots, guardWeights, { unknown, unknownGuard }).length > 0;
  let initial = startSlots;
  if (invalidStart) {
    let bestRank = null;
    for (const next of neighbours(schedule, startSlots)) {
      if (evaluated++ >= Math.min(5000, budget / 3)) break;
      if (validate(schedule, next, guardWeights, { unknown, unknownGuard, prepared }).length) continue;
      const r = rank(next); archive.set(next.map(s => `${s.day}:${s.stage}:${s.start}`).join('|'), { slots: next, rank: r });
      if (!bestRank || compare(r, bestRank) < 0) { initial = next; bestRank = r; }
    }
    if (!bestRank) return { repairs: [], evaluated, invalid: true, seed };
  }
  for (let restart = 0; restart < 3; restart++) {
    rng = (seed + restart) >>> 0;
    let current = initial, perturbed = false;
    const limit = Math.floor(budget * (restart + 1) / 3);
    while (evaluated < limit) {
      let best = current, bestRank = rank(current), perturbation = null, legal = 0;
      for (const next of neighbours(schedule, current)) {
        if (evaluated >= limit) break; evaluated++;
        if (validate(schedule, next, guardWeights, { unknown, unknownGuard, prepared }).length) continue;
        if (random() < 1 / ++legal) perturbation = next;
        const r = rank(next);
        if (compare(r, bestRank) < 0) { best = next; bestRank = r; }
        if (invalidStart || r[0] < base[0] - 1e-9) archive.set(next.map(s => `${s.day}:${s.stage}:${s.start}`).join('|'), { slots: next, rank: r });
      }
      if (best === current) { if (perturbed || !perturbation) break; current = perturbation; perturbed = true; }
      else current = best;
    }
  }
  return { repairs: [...archive.values()].sort((a, b) => compare(a.rank, b.rank)).slice(0, 2)
    .filter(r => !validate(schedule, r.slots, guardWeights, { unknown, unknownGuard }).length)
    .map(r => ({ ...r, metrics: metrics(r.slots, weights, schedule.buffer) })), evaluated, seed };
}

// Union of concurrent marked sets; repeated overlaps must not be counted twice.
export function majorDrawMinutes(slots) {
  const draws = slots.filter(s => s.majorDraw && !s.excluded);
  let minutes = 0;
  for (const a of draws) {
    const spans = draws.filter(b => b.id !== a.id && b.day === a.day && b.stage !== a.stage)
      .map(b => [Math.max(a.start, b.start), Math.min(a.start + a.duration, b.start + b.duration)])
      .filter(([start, end]) => end > start).sort((a, b) => a[0] - b[0]);
    let covered = 0, end = a.start;
    for (const [start, stop] of spans) { covered += Math.max(0, stop - Math.max(start, end)); end = Math.max(end, stop); }
    minutes += a.duration - covered;
  }
  return minutes;
}
export function unknownChanges(before, after, weights, buffer = 0) {
  const originals = new Map(before.map(s => [s.id, s])), result = [];
  for (let i = 0; i < after.length; i++) for (const b of after.slice(i + 1)) {
    const a = after[i];
    if (a.excluded || b.excluded || a.act === b.act || weights[pairKey(a.act, b.act)] != null) continue;
    const beforeMinutes = overlap(originals.get(a.id), originals.get(b.id), buffer), afterMinutes = overlap(a, b, buffer);
    if (beforeMinutes !== afterMinutes) result.push({ setIds: [a.id, b.id], acts: [a.act, b.act], beforeMinutes, afterMinutes, delta: afterMinutes - beforeMinutes });
  }
  return result;
}
