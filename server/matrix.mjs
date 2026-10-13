import { pairKey } from './schedule.mjs';
export function percentiles(values) {
  const entries = Object.entries(values).filter(([, v]) => Number.isFinite(v));
  if (entries.length < 2) return {};
  return Object.fromEntries(entries.map(([id, value]) => [id, (entries.filter(([, v]) => v < value).length + (entries.filter(([, v]) => v === value).length - 1) / 2) / (entries.length - 1)]));
}
export function weightsFromRows(rows, usable = Object.keys(rows)) {
  const ranks = Object.fromEntries(Object.entries(rows).map(([name, row]) => [name, percentiles(row)]));
  const weights = {};
  for (const a of usable) for (const b of usable) if (a !== b && ranks[a]?.[b] != null && ranks[b]?.[a] != null) weights[pairKey(a, b)] = (ranks[a][b] + ranks[b][a]) / 2;
  return { weights, ranks };
}
export function chunks(ids) {
  if (ids.length <= 50) return [ids];
  const sentinels = ids.slice(0, 2), rest = ids.slice(2), result = [];
  for (let i = 0; i < rest.length; i += 48) result.push([...sentinels, ...rest.slice(i, i + 48)]);
  return result;
}
