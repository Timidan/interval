import { csv, minute, validate } from './schedule.mjs';
export function importSchedule(text, timezone) {
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }); } catch { throw new Error('A valid festival timezone is required'); }
  const rows = csv(text), required = ['day', 'stage', 'act', 'start', 'end'];
  if (!rows.length || rows.length > 150) throw new Error('Imports require 1–150 sets');
  for (const col of required) if (!(col in rows[0])) throw new Error(`Missing required column: ${col}`);
  const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
  const slots = rows.map((r, i) => {
    for (const col of required) if (!r[col]?.trim()) throw new Error(`Row ${i + 2}: ${col} is required`);
    if (r.act.length > 160 || r.stage.length > 160) throw new Error(`Row ${i + 2}: act and stage names must be at most 160 characters`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.day) || !Number.isFinite(minute(r.day + 'T00:00'))) throw new Error(`Row ${i + 2}: day must be an ISO date`);
    const startText = r.start.includes('T') ? r.start : `${r.day}T${r.start}`, endText = r.end.includes('T') ? r.end : `${r.day}T${r.end}`;
    if (!iso.test(startText) || !iso.test(endText) || new Date(minute(startText) * 60000).toISOString().slice(0, 16) !== startText || new Date(minute(endText) * 60000).toISOString().slice(0, 16) !== endText) throw new Error(`Row ${i + 2}: start and end must be valid 24-hour local times or dated ISO times`);
    const start = minute(startText), duration = minute(endText) - start;
    if (duration <= 0 || duration > 1440) throw new Error(`Row ${i + 2}: end must follow start; date overnight endings explicitly`);
    if (r.hold && !['day', 'stage', 'start', 'exact'].includes(r.hold)) throw new Error(`Row ${i + 2}: invalid hold`);
    if (r.band && !['opener', 'middle', 'sub-headline', 'headline'].includes(r.band)) throw new Error(`Row ${i + 2}: invalid billing band`);
    if (r.tier && (!Number.isInteger(Number(r.tier)) || Number(r.tier) < 1 || Number(r.tier) > 100)) throw new Error(`Row ${i + 2}: tier must be 1–100`);
    return { id: `import-${i}`, act: r.act.trim(), label: r.act.trim(), stage: r.stage.trim(), day: r.day, start, duration,
      tier: r.tier ? Number(r.tier) : 1000 + [...new Set(rows.map(r => r.stage.trim()))].indexOf(r.stage.trim()),
      band: r.band || 'middle', locked: r.hold === 'exact', holds: r.hold ? [r.hold] : [], unresolved: true };
  });
  if (new Set(slots.map(s => s.act)).size > 60) throw new Error('Live imports support up to 60 distinct acts');
  const stages = [];
  for (const slot of slots) if (!stages.some(s => s.name === slot.stage && s.day === slot.day)) {
    const group = slots.filter(s => s.day === slot.day && s.stage === slot.stage);
    if (group.some(s => s.tier !== slot.tier)) throw new Error('Each stage must have a consistent tier');
    stages.push({ name: slot.stage, day: slot.day, tier: slot.tier, open: Math.min(...group.map(s => s.start)), close: Math.max(...group.map(s => s.start + s.duration)), changeover: 0 });
  }
  for (const slot of slots) {
    const peers = slots.filter(s => s.day === slot.day && s.tier === slot.tier && s.band === slot.band);
    slot.earliest = Math.min(...peers.map(s => s.start)); slot.latestEnd = Math.max(...peers.map(s => s.start + s.duration));
  }
  const schedule = { id: 'import', slots, stages, k: 4, buffer: 0, holds: 'Operator-declared holds; inferred timetable windows' };
  const errors = validate(schedule, slots, {}, { unknown: false });
  if (errors.length) throw new Error(`Invalid timetable: ${errors.join(', ')}`);
  return schedule;
}
