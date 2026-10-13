import { randomUUID } from 'node:crypto';
import { seed, pairKey, same, overlap, metrics, validate, minute, unknownChanges } from './schedule.mjs';
import { loadSnapshot, snapshotSummary, evidenceRef, evidence } from './scoring.mjs';
import { importSchedule } from './import.mjs';
import { db, hash } from './qloo.mjs';

export const seeds = [
  { id: 'acl-friday', name: 'Austin City Limits · Weekend 1 · Friday', timezone: 'America/Chicago', days: ['2026-10-02'], source: 'https://www.aclfestival.com/schedule', verified: '2026-10-12' },
  { id: 'iii-friday', name: 'III Points · Friday', timezone: 'America/New_York', days: ['2026-10-16'], source: 'https://www.iiipoints.com/set-times/', verified: '2026-10-12' },
  { id: 'iii-saturday', name: 'III Points · Saturday', timezone: 'America/New_York', days: ['2026-10-17'], source: 'https://www.iiipoints.com/set-times/', verified: '2026-10-12' },
  { id: 'iii-points', name: 'III Points · Friday and Saturday', timezone: 'America/New_York', days: ['2026-10-16', '2026-10-17'], source: 'https://www.iiipoints.com/set-times/', verified: '2026-10-12' },
];
export const saveRun = run => db.prepare('INSERT OR REPLACE INTO runs(id,data) VALUES(?,?)').run(run.id, JSON.stringify(run));
export function pruneRuns() {
  const days = Number(process.env.RUN_TTL_DAYS || 7);
  if (!Number.isFinite(days) || days <= 0) throw new Error('RUN_TTL_DAYS must be a positive number');
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  const { changes } = db.prepare(`DELETE FROM runs
    WHERE substr(id, 1, 1) != '_'
      AND julianday(json_extract(data, '$.createdAt')) < julianday(?)
      AND COALESCE(json_array_length(data, '$.agent.turns'), 0) = 0`).run(cutoff);
  console.log(`Interval run cleanup: removed ${changes} runs`);
  return changes;
}
export function loadRun(id, owner) {
  const row = db.prepare('SELECT data FROM runs WHERE id=?').get(id);
  if (!row) return null;
  const run = JSON.parse(row.data); return run.owner === owner ? run : null;
}
export function syncIdentities(run) {
  for (const slot of run.schedule.slots) slot.unresolved = !slot.excluded && run.identities.find(i => i.act === slot.act)?.status !== 'confirmed';
  run.current = run.current.map(s => ({ ...run.schedule.slots.find(o => o.id === s.id), day: s.day, stage: s.stage, start: s.start }));
}
export function newRun(input, owner) {
  const info = seeds.find(s => s.id === input.seedId);
  if (input.seedId && !info) throw new Error('Unknown seed');
  if (!info && (typeof input.csv !== 'string' || typeof input.timezone !== 'string')) throw new Error('Provide seedId or CSV and timezone');
  const schedule = info ? seed(info.id) : importSchedule(input.csv, input.timezone);
  const snapshot = info ? loadSnapshot(info.id) : null;
  if (input.unknownGuard != null && !['pair', 'net'].includes(input.unknownGuard)) throw new Error('Invalid unknown guard');
  schedule.unknownGuard = input.unknownGuard || 'net';
  schedule.objective = 'affinity';
  const names = [...new Set(schedule.slots.filter(s => !s.excluded).map(s => s.act))];
  const identities = names.map(act => snapshot?.identityReview?.find(i => i.act === act) ?? { act, status: 'unresolved', candidates: [] });
  const run = { id: randomUUID(), owner, version: 1, constraintVersion: 1, origin: info?.id || 'import', timezone: info?.timezone || input.timezone,
    createdAt: new Date().toISOString(), schedule, current: structuredClone(schedule.slots), identities, snapshot, repairs: [], undo: [],
    status: snapshot ? 'ready' : 'needs_identities', comparison: { llm: 'pending', operator: 'pending', genre: null },
    assumptions: info ? ['Retrospective scenario', schedule.holds, 'Production requirements and actual contracts are not verified', 'Full-seed identity coverage failed; scored portion only', 'City conditioning unavailable; global snapshot'] :
      ['Holds come from your CSV', 'Changeovers and artist availability weren’t supplied, so no changeover time or artist availability limits are added; sets on the same stage and sets by the same artist cannot overlap', 'Stage hours run from the first set’s start to the last set’s finish in your CSV. Each set must fit between the earliest start and latest finish of its billing band at its stage size on that day, within those stage hours and any other holds', 'Without a supplied tier, each stage counts as its own size'] };
  syncIdentities(run); saveRun(run); return run;
}
export function clashes(run, slots = run.current) {
  const result = [], snapshot = run.snapshot;
  if (!snapshot) return result;
  for (let i = 0; i < slots.length; i++) for (let j = i + 1; j < slots.length; j++) {
    const a = slots[i], b = slots[j]; if (a.excluded || b.excluded || a.act === b.act) continue;
    const minutes = overlap(a, b, run.schedule.buffer), weight = snapshot.weights[pairKey(a.act, b.act)] ?? null;
    if (minutes > 0 && (weight == null || weight >= .9)) result.push({ setIds: [a.id, b.id], acts: [a.act, b.act], overlapMinutes: overlap(a, b), bufferedMinutes: minutes,
      weight, cost: weight == null ? null : weight * minutes, evidenceRef: evidenceRef(snapshot, a.act, b.act) });
  }
  return result;
}
export function coverage(run) {
  const names = run.identities.map(i => i.act), totalPairs = names.length * (names.length - 1) / 2;
  let usablePairs = 0;
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) if (run.snapshot?.weights[pairKey(names[i], names[j])] != null) usablePairs++;
  return { confirmed: run.identities.filter(i => i.status === 'confirmed').length, acts: names.length, usablePairs, totalPairs, unknownPairs: totalPairs - usablePairs };
}
export function view(run) {
  const { owner, undo, agentPrivate, ...safe } = run;
  const c = coverage(run);
  return { ...safe, snapshot: snapshotSummary(run.snapshot), metrics: c.usablePairs ? metrics(run.current, run.snapshot.weights, run.schedule.buffer) : null,
    clashes: clashes(run), coverage: c, canUndo: undo.length > 0, validity: validate(run.schedule, run.current, run.snapshot?.weights || {}) };
}
export function pairEvidence(run, ref) {
  if (!run.snapshot) return null;
  const names = run.identities.map(i => i.act);
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) if (evidenceRef(run.snapshot, names[i], names[j]) === ref) return evidence(run.snapshot, names[i], names[j]);
  return null;
}
export function proposal(run, result, search) {
  const slots = result.slots, changes = slots.filter((s, i) => !same(s, run.current[i])).map(s => ({ id: `change-${s.id}`, setId: s.id, act: s.act, before: run.current.find(o => o.id === s.id), after: s, attributedDelta: 0 }));
  const ledger = [];
  for (let i = 0; i < slots.length; i++) for (let j = i + 1; j < slots.length; j++) {
    const a = slots[i], b = slots[j], weight = run.snapshot.weights[pairKey(a.act, b.act)];
    if (a.excluded || b.excluded || a.act === b.act || !(weight >= .9)) continue;
    const beforeMinutes = overlap(run.current[i], run.current[j], run.schedule.buffer), afterMinutes = overlap(a, b, run.schedule.buffer);
    if (beforeMinutes === afterMinutes) continue;
    const affected = changes.filter(c => c.setId === a.id || c.setId === b.id), delta = weight * (afterMinutes - beforeMinutes);
    for (const change of affected) change.attributedDelta += delta / affected.length;
    ledger.push({ setIds: [a.id, b.id], acts: [a.act, b.act], beforeMinutes, afterMinutes, weight, delta,
      evidenceRef: evidenceRef(run.snapshot, a.act, b.act), affectedChangeIds: affected.map(c => c.id) });
  }
  const errors = validate(run.schedule, slots, run.snapshot.weights);
  return { id: randomUUID(), version: run.version, constraintVersion: run.constraintVersion, snapshotId: run.snapshot.id, createdAt: new Date().toISOString(),
    slots, changes, ledger, unknownGuard: run.schedule.unknownGuard || 'pair', unknownChanges: unknownChanges(run.current, slots, run.snapshot.weights, run.schedule.buffer), before: metrics(run.current, run.snapshot.weights, run.schedule.buffer), after: metrics(slots, run.snapshot.weights, run.schedule.buffer),
    validity: { passed: errors.length === 0, errors }, search: { ...search, budget: 15000, solverVersion: 'interval-2', reproducibilityKey: hash([run.schedule, run.current, run.snapshot.id, search.seed, 15000, 'interval-2']) } };
}
export function constraint(run, input) {
  // Validate on a copy so a conflict on a later subject cannot partially edit holds.
  const draft = structuredClone(run);
  updateConstraint(draft, input);
  Object.assign(run, draft);
}
function updateConstraint(run, input) {
  if (!input || typeof input !== 'object') throw new Error('Invalid constraint');
  const integer = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
  if (input.kind === 'move_budget') { if (!integer(input.value, 0, 4)) throw new Error('Move budget must be 0–4'); run.schedule.k = input.value; }
  else if (input.kind === 'walking_buffer') { if (!integer(input.value, 0, 60)) throw new Error('Walking buffer must be 0–60 minutes'); run.schedule.buffer = input.value; }
  else if (input.kind === 'unknown_guard') {
    if (!['pair', 'net'].includes(input.value)) throw new Error('Invalid unknown guard');
    run.schedule.unknownGuard = input.value;
  } else if (input.kind === 'objective') {
    if (!['affinity', 'balanced', 'concurrent'].includes(input.value)) throw new Error('Invalid objective');
    if (input.value !== 'affinity' && run.schedule.slots.filter(s => s.majorDraw).length < 2) throw new Error('Confirm major draws before changing this objective');
    run.schedule.objective = input.value;
  } else {
    if (!Array.isArray(input.setIds) || !input.setIds.length || input.setIds.some(id => !run.schedule.slots.some(s => s.id === id))) throw new Error('Unknown constraint subject');
    const subjects = run.schedule.slots.filter(s => input.setIds.includes(s.id));
    if (input.kind === 'lock') {
      if (!Array.isArray(input.holds) || input.holds.some(h => !['day', 'stage', 'start', 'exact'].includes(h))) throw new Error('Invalid holds');
      for (const s of subjects) {
        const current = run.current.find(c => c.id === s.id);
        s.holds = [...new Set(input.holds)]; s.locked = s.excluded || s.holds.includes('exact');
        s.holdPlacement = s.holds.length ? { day: current.day, stage: current.stage, start: current.start } : undefined;
      }
    } else if (input.kind === 'availability') {
      const days = [...new Set(run.schedule.stages.map(s => s.day))];
      if (!Array.isArray(input.days) || !input.days.length || input.days.some(d => !days.includes(d))) throw new Error('Availability must use programme days in this run');
      if ([input.notBefore, input.notAfter].some(n => n != null && !integer(n, 0, 2880))) throw new Error('Availability times must be local programme-day minutes, 0–2880');
      for (const s of subjects) {
        const held = s.holdPlacement || s, heldOffset = held.start - minute(`${held.day}T00:00`);
        if ((s.locked || s.holds?.includes('day')) && !input.days.includes(held.day)) throw new Error('Availability conflicts with an existing hold; explicitly edit that hold first');
        if (s.unresolved && !input.days.includes(s.day)) throw new Error('Unresolved acts must stay fixed');
        if ((s.locked || s.holds?.includes('start')) && ((input.notBefore != null && heldOffset < input.notBefore) || (input.notAfter != null && heldOffset + s.duration > input.notAfter))) throw new Error('Availability conflicts with an existing start hold');
        s.allowedDays = input.days; s.notBefore = input.notBefore; s.notAfter = input.notAfter;
      }
    } else if (input.kind === 'allowed_stages') {
      if (!Array.isArray(input.stages) || !input.stages.length) throw new Error('Allowed stages cannot be empty');
      for (const s of subjects) {
        if (input.stages.some(name => !run.schedule.stages.some(t => t.name === name && t.tier === s.tier))) throw new Error('Allowed stages must preserve stage tier');
        if ((s.locked || s.holds?.includes('stage')) && !input.stages.includes((s.holdPlacement || s).stage)) throw new Error('Stage request conflicts with an existing hold');
        s.allowedStages = input.stages;
      }
    } else throw new Error('Unsupported constraint');
  }
  syncIdentities(run); run.version++; run.constraintVersion++; run.repairs = []; run.reason = undefined;
  run.status = run.snapshot ? 'ready' : 'needs_scoring';
}
