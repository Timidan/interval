import aclCsv from '../../seeds/acl-2026-w1-fri.csv?raw';
import iiiCsv from '../../seeds/iii-points-2026.csv?raw';
import type { Run, Slot as RunSlot } from '@/lib/api';

export type Slot = {
  id: string;
  day: string;
  stage: string;
  act: string;
  start: number; // minutes after the programme day's midnight; can pass 1440 after midnight
  end: number;
  b2b: boolean;
  held: boolean;
  /** Qloo has no confirmed identity for this act, so every pair it is in stays unknown. */
  unknown?: boolean;
};

export type Day = { id: string; label: string };

export type Festival = {
  id: 'acl' | 'iii';
  name: string;
  edition: string;
  place: string;
  source: string;
  sourceUrl: string;
  verified: string;
  holds: string;
  notShown?: string;
  days: Day[];
  stages: string[];
  sets: Slot[];
};

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(f => f !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows;
  return body.map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

function minutesAfter(day: string, iso: string): number {
  const [d, t] = iso.split('T');
  const dayMs = Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10));
  const isoMs = Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
  const [h, m] = t.split(':').map(Number);
  return Math.round((isoMs - dayMs) / 60000) + h * 60 + m;
}

function ordered<T>(items: T[]): T[] { return [...new Set(items)]; }

const ACL_HELD = new Set(['Skrillex', 'Charli XCX']);
const acl = parseCsv(aclCsv).filter(r => r.stage !== 'Austin Kiddie Limits' && r.act !== 'Silent Disco');
const iii = parseCsv(iiiCsv);

export const FESTIVALS: Festival[] = [
  {
    id: 'acl',
    name: 'Austin City Limits 2026',
    edition: 'Weekend 1',
    place: 'Zilker Park, Austin',
    source: 'official C3 schedule image',
    sourceUrl: 'https://www.aclfestival.com/schedule',
    verified: 'Oct 12, 2026',
    holds: 'Inferred holds, loosened to billing bands',
    notShown: "Kids' area and silent disco not shown",
    days: [{ id: '2026-10-02', label: 'Fri' }],
    stages: ordered(acl.map(r => r.stage)),
    sets: acl.map((r, i) => ({
      id: `acl-${i}`,
      day: r.programme_day,
      stage: r.stage,
      act: r.act,
      start: minutesAfter(r.programme_day, r.start_local),
      end: minutesAfter(r.programme_day, r.end_local),
      b2b: false,
      held: ACL_HELD.has(r.act),
    })),
  },
  {
    id: 'iii',
    name: 'III Points 2026',
    edition: 'Miami',
    place: 'Mana Wynwood, Miami',
    source: 'official set-times page',
    sourceUrl: 'https://www.iiipoints.com/set-times/',
    verified: 'Oct 12, 2026',
    holds: 'No holds set',
    days: [{ id: '2026-10-16', label: 'Fri' }, { id: '2026-10-17', label: 'Sat' }],
    stages: ordered(iii.map(r => r.stage)),
    sets: iii.map((r, i) => ({
      id: `iii-${i}`,
      day: r.programme_day,
      stage: r.stage,
      act: r.act,
      start: minutesAfter(r.programme_day, r.start_local),
      end: minutesAfter(r.programme_day, r.end_local),
      b2b: r.b2b === 'yes',
      held: false,
    })),
  },
];

export const festival = (id: Festival['id']) => FESTIVALS.find(f => f.id === id)!;
export const daySets = (f: Festival, day: string) => f.sets.filter(s => s.day === day);
export const dayStages = (f: Festival, sets: Slot[]) => f.stages.filter(st => sets.some(s => s.stage === st));

/** An API slot in the sheet's shape. API times are local-calendar minutes encoded with UTC arithmetic. */
export function sheetSlot(s: RunSlot, unknown = false): Slot {
  const start = s.start - Date.parse(`${s.day}T00:00:00Z`) / 60000;
  return { id: s.id, day: s.day, stage: s.stage, act: s.label, start, end: start + s.duration,
    b2b: /\bb2b\b/i.test(s.label), held: !!s.locked && !s.unresolved, unknown: !!s.unresolved || unknown };
}

/** One programme day of an API run in the sheet's shape: the current running order, or a proposal's slots. */
export function fromRun(run: Run, day: string, slots: RunSlot[] = run.current): { sets: Slot[]; stages: string[] } {
  const unknown = new Set(run.identities.filter(i => i.status !== 'confirmed').map(i => i.act));
  const sets = slots.filter(s => s.day === day && !s.excluded).map(s => sheetSlot(s, unknown.has(s.act)));
  const stages = run.schedule.stages.filter(st => st.day === day && sets.some(s => s.stage === st.name)).map(st => st.name);
  return { sets, stages };
}

const overlap = (a: Slot, b: Slot) => a.stage !== b.stage && Math.min(a.end, b.end) > Math.max(a.start, b.start);

/** Sets on other stages that play at the same time. A timetable fact, not a clash: clashes need Qloo. */
export function concurrent(sets: Slot[], target: Slot): Slot[] {
  return sets.filter(s => s.id !== target.id && overlap(s, target));
}

export function overlapPairs(sets: Slot[]): number {
  let n = 0;
  for (let i = 0; i < sets.length; i++) for (let j = i + 1; j < sets.length; j++) if (overlap(sets[i], sets[j])) n++;
  return n;
}

export function bounds(sets: Slot[]) {
  const start = Math.floor(Math.min(...sets.map(s => s.start)) / 60) * 60;
  const end = Math.ceil(Math.max(...sets.map(s => s.end)) / 60) * 60;
  return { start, end };
}

export function clock(min: number, withPeriod = true): string {
  const h24 = Math.floor(min / 60) % 24, m = min % 60;
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  const period = h24 < 12 ? 'AM' : 'PM';
  return `${h}:${String(m).padStart(2, '0')}${withPeriod ? ` ${period}` : ''}`;
}

export function hourLabel(min: number): string {
  const h24 = Math.floor(min / 60) % 24;
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h} ${h24 < 12 ? 'AM' : 'PM'}`;
}

/** "1 set", "4 sets": counts with the right noun, never "1 sets". */
export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const span = (s: Slot) => `${clock(s.start, false)}–${clock(s.end)}`;
