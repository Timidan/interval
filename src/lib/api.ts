import type { Comparison, IdentityEstimate, IdentityEstimateResponse, AgentHealth, MessageRequest, Recording, ApiFailure, CreateRun, IdentityAction, PairEvidence, Run, RunAction, ScoreRequest, ScoreResponse, SeedInfo } from '../../shared/api';
export type * from '../../shared/api';

export class ApiError extends Error {
  constructor(public status: number, public detail: ApiFailure) { super(detail.reason); }
}
async function fetchApi<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api${path}`, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), signal });
  const data: unknown = await response.json();
  if (!response.ok) throw new ApiError(response.status, data as ApiFailure);
  return data as T;
}
function identities(id: string, body: IdentityEstimate): Promise<IdentityEstimateResponse>;
function identities(id: string, body: Exclude<IdentityAction, IdentityEstimate>): Promise<Run>;
function identities(id: string, body: IdentityAction): Promise<Run | IdentityEstimateResponse>;
function identities(id: string, body: IdentityAction) {
  return fetchApi<Run | IdentityEstimateResponse>(`/runs/${encodeURIComponent(id)}/identities`, body);
}
export const api = {
  comparison: (seedId: string, signal?: AbortSignal) => fetchApi<Comparison>(`/comparisons/${encodeURIComponent(seedId)}`, undefined, signal),
  agentHealth: (signal?: AbortSignal) => fetchApi<AgentHealth>('/agent', undefined, signal),
  seeds: (signal?: AbortSignal) => fetchApi<SeedInfo[]>('/seeds', undefined, signal),
  createRun: (body: CreateRun) => fetchApi<Run>('/runs', body),
  run: (id: string, signal?: AbortSignal) => fetchApi<Run>(`/runs/${encodeURIComponent(id)}`, undefined, signal),
  identities,
  score: (id: string, body: ScoreRequest) => fetchApi<ScoreResponse>(`/runs/${encodeURIComponent(id)}/score`, body),
  action: (id: string, body: RunAction) => fetchApi<Run>(`/runs/${encodeURIComponent(id)}/actions`, body),
  evidence: (id: string, ref: string) => fetchApi<PairEvidence>(`/runs/${encodeURIComponent(id)}/evidence/${encodeURIComponent(ref)}`),
  recordings: (id: string) => fetchApi<{ recordings: Recording[] }>(`/runs/${encodeURIComponent(id)}/messages`),
  message: (id: string, body: MessageRequest) => fetchApi<Run>(`/runs/${encodeURIComponent(id)}/messages`, body),
};
