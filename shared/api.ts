/** Times are integer minutes on the festival's local calendar, encoded with UTC arithmetic.
 * Format with UTC getters; do not convert them to the browser's timezone. */
export type UnknownGuard = 'pair' | 'net';
export type SeedId = 'acl-friday' | 'iii-friday' | 'iii-saturday' | 'iii-points';
export type Band = 'opener' | 'middle' | 'sub-headline' | 'headline';
export type Hold = 'day' | 'stage' | 'start' | 'exact';
export interface Slot {
  id: string; act: string; label: string; day: string; stage: string; start: number; duration: number;
  tier: number; band?: Band; billing?: number; earliest: number; latestEnd: number;
  excluded?: boolean; unresolved?: boolean; locked?: boolean; holds?: Hold[];
  allowedDays?: string[]; allowedStages?: string[]; notBefore?: number; notAfter?: number;
  majorDraw?: boolean;
  holdPlacement?: { day: string; stage: string; start: number };
}
export interface Stage { name: string; day: string; tier: number; open: number; close: number; changeover: number }
export interface Schedule { id: string; slots: Slot[]; stages: Stage[]; k: number; buffer: number; holds: string; unknownGuard?: UnknownGuard; objective?: 'affinity' | 'balanced' | 'concurrent' }
export interface Candidate { ref: string; entityId: string; name: string; description: string; genres: string[]; external: Record<string, { id?: string }> }
export interface Identity { act: string; status: 'confirmed' | 'ambiguous' | 'unresolved'; entityId?: string | null; candidates: Candidate[]; evidenceRef?: string; confirmationSource?: string; note?: string; suggestedRef?: string; suggestedFrom?: string }
export interface Metrics { cost: number; strongClashes: number; unknownClashes: number; unknownMinutes: number; majorDrawMinutes: number }
export interface Coverage { confirmed: number; acts: number; usablePairs: number; totalPairs: number; unknownPairs: number }
export interface Clash { setIds: [string, string]; acts: [string, string]; overlapMinutes: number; bufferedMinutes: number; weight: number | null; cost: number | null; evidenceRef?: string }
export interface PairLedger { setIds: [string, string]; acts: [string, string]; beforeMinutes: number; afterMinutes: number; weight: number; delta: number; evidenceRef: string; affectedChangeIds: string[] }
export interface Change { id: string; setId: string; act: string; before: Slot; after: Slot; attributedDelta: number }
export interface Repair {
  id: string; version: number; constraintVersion: number; snapshotId: string; createdAt: string;
  slots: Slot[]; changes: Change[]; ledger: PairLedger[]; before: Metrics; after: Metrics;
  unknownGuard: UnknownGuard; unknownChanges: UnknownChange[];
  validity: { passed: boolean; errors: string[] }; search: { seed: number; evaluated: number; budget: number; solverVersion: string; reproducibilityKey: string };
}
export interface SnapshotSummary { id: string; fetchedAt: string; context: 'global'; quality: 'partial' | 'complete'; scope: string; gates: string[] }
export interface SeedInfo { id: SeedId; name: string; timezone: string; days: string[]; source: string; verified: string; snapshot: SnapshotSummary | null }
export interface Run {
  id: string; version: number; constraintVersion: number; origin: string; timezone: string; createdAt: string;
  schedule: Schedule; current: Slot[]; identities: Identity[]; snapshot: SnapshotSummary | null;
  metrics: Metrics | null; clashes: Clash[]; coverage: Coverage; repairs: Repair[]; canUndo: boolean;
  status: 'needs_identities' | 'needs_scoring' | 'resolving' | 'scoring' | 'ready' | 'searching' | 'none_found' | 'failed' | 'thinking';
  agent?: { turns: AgentTurn[] };
  progress?: { completed: number; total: number }; callsUsed?: number; reason?: string; validity: string[];
  assumptions: string[]; comparison: { llm: 'pending'; operator: 'pending'; genre: { label: string; metrics: Metrics; slots: Slot[]; validity: string[] } | null };
}
export type CreateRun = ({ seedId: SeedId } | { csv: string; timezone: string }) & { unknownGuard?: UnknownGuard };
export interface IdentityEstimate { operation: 'resolve'; mode: 'estimate'; expectedVersion: number }
export interface IdentityEstimateResponse { estimatedCalls: number; maximumCalls: number; live: boolean }
export type IdentityAction = IdentityEstimate | { operation: 'resolve'; maxNewCalls: number; expectedVersion: number } |
  { operation: 'confirm'; act: string; candidateRef: string; expectedVersion: number } |
  { operation: 'unresolve'; act: string; expectedVersion: number };
export type Constraint =
  { kind: 'lock'; setIds: string[]; holds: Hold[] } |
  { kind: 'availability'; setIds: string[]; days: string[]; notBefore?: number; notAfter?: number } |
  { kind: 'allowed_stages'; setIds: string[]; stages: string[] } |
  { kind: 'move_budget'; value: number } |
  { kind: 'walking_buffer'; value: number } |
  { kind: 'unknown_guard'; value: UnknownGuard } |
  { kind: 'objective'; value: 'affinity' | 'balanced' | 'concurrent' };
export type RunAction =
  { type: 'repair'; expectedVersion: number; seed?: number; unknownGuard?: UnknownGuard } |
  { type: 'constraint'; expectedVersion: number; expectedConstraintVersion: number; constraint: Constraint } |
  { type: 'apply'; expectedVersion: number; repairId: string } |
  { type: 'undo'; expectedVersion: number } |
  { type: 'baseline'; expectedVersion: number; kind: 'genre_only' | 'llm_only' };
export interface ScoreRequest { mode: 'estimate' | 'fetch'; maxNewCalls: number; expectedVersion: number; context?: 'global' }
export interface ScoreResponse { status: 'estimated' | 'queued' | 'complete'; estimatedCalls: number; maximumCalls: number; callsUsed: number; callsRemaining: number; live: boolean; run?: Run }
export interface DirectionEvidence { source: string; candidate: string; affinity: number | null; percentile: number | null; rowPopulation: number; row: { act: string; affinity: number; percentile: number }[]; reason?: string; request: { method: string; path: string; params: Record<string, string | number> } | null; fetched: string | null }
export interface PairEvidence { ref: string; snapshotId: string; acts: [string, string]; weight: number | null; threshold: 0.9; directions: DirectionEvidence[] }
export interface ApiFailure { reason: string; errors?: string[]; run?: Run }

export interface UnknownChange { setIds: string[]; acts: string[]; beforeMinutes: number; afterMinutes: number; delta: number }
export interface AgentHealth { status: 'available' | 'limited' | 'unavailable' | 'unknown'; model?: string; effort?: string; retry_at: number | null; reason?: string }
export interface MessageRequest { message: string; expectedVersion: number; majorDrawSetIds?: string[]; replayId?: string }
export interface GroundedSegment { templateId: string; factRefs: string[]; text: string; kind: 'fact' | 'question'; serverAdded?: boolean }
export interface AgentFact { id: string; templateId: string; text: string; data: unknown; kind?: 'question' }
export interface AgentStep { id: string; kind: 'model' | 'tool'; status: 'running' | 'complete' | 'invalid' | 'rejected' | 'failed'; startedAt: string; completedAt?: string; name?: string; args?: unknown; result?: unknown; reason?: string; model?: string; effort?: string; completionId?: string }
export interface AgentTurn { id: string; message: string; status: 'thinking' | 'complete' | 'question' | 'limited' | 'unavailable' | 'failed'; mode: 'live' | 'recorded'; startedAt: string; completedAt?: string; modelCalls: number; repairSearches: number; toolCalls: number; steps: AgentStep[]; facts: AgentFact[]; segments: GroundedSegment[]; retry_at?: number | null; reason?: string; recordingId?: string; recordedAt?: string; label?: string; replayedAt?: string }

export interface Recording { id: string; message: string; recordedAt: string; label: string }

export interface ComparisonRow {
  label: string; kind: 'original' | 'llm_only' | 'genre_only' | 'interval'; unknownGuard?: UnknownGuard;
  available: boolean; reason?: string; diagnostic?: string; moved: number | null; acts: string[]; minutesShifted: number | null;
  changes: { act: string; setId: string; before: Pick<Slot, 'day' | 'stage' | 'start' | 'duration'>; after: Pick<Slot, 'day' | 'stage' | 'start' | 'duration'> }[];
  metrics: Pick<Metrics, 'cost' | 'strongClashes' | 'unknownClashes' | 'unknownMinutes'> | null;
  logistics: boolean; pairGuard: boolean; netGuard: boolean;
}
export interface Comparison { seedId: Exclude<SeedId, 'iii-points'>; frozenAt: string; rows: ComparisonRow[] }
