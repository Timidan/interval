import { readFileSync } from 'node:fs';
import { candidateList, buildSnapshot, saveSnapshot, loadSnapshot } from '../server/scoring.mjs';
import { callCount } from '../server/qloo.mjs';
import { seed, acts } from '../server/schedule.mjs';
const read = name => JSON.parse(readFileSync(`cache/probes/${name}.json`));
const search = [...read('identities'), ...read('saturday-identities')];
const reviews = [...read('identity-review'), ...read('saturday-review')];
for (const id of ['acl-friday', 'iii-points']) {
  const names = acts(seed(id));
  const identities = names.map(act => {
    const review = reviews.find(r => r.act === act) ?? { act, status: 'unresolved' };
    const found = search.find(r => r.name === act);
    const result = act === 'Jesse Welles' ? found.retry : found;
    return { ...review, confirmationSource: review.status === 'confirmed' ? 'curated seed metadata review' : undefined,
      candidates: result ? candidateList({ ref: result.ref, data: { results: { entities: result.candidates } } }) : [] };
  });
  const snapshot = loadSnapshot(id) ?? await buildSnapshot(identities, id === 'acl-friday' ? 'ACL Friday confirmed acts' : 'III Points Friday and Saturday confirmed acts', ({ completed, total }) => { if (completed === total) console.log(`Snapshot ${id}: ${completed}/${total} rows`); });
  snapshot.identityReview = identities;
  saveSnapshot(id, snapshot);
  if (id === 'iii-points') { saveSnapshot('iii-friday', snapshot); saveSnapshot('iii-saturday', snapshot); }
}
console.log(`Saved snapshots; total Qloo calls: ${callCount()}`);
