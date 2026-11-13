// Reciprocal rank fusion, as in retrieval.Retriever.hybrid in Python. Kept pure so the ranks the
// demo shows ("keyword #3, vector #1") come from the same code that orders the passages.

export interface Ranked {
  id: string;
  kw: number | null; // 1-based rank in the keyword list, null if keyword search did not return it
  vec: number | null; // 1-based rank in the vector list
  fused: number; // sum of 1 / (rrfK + rank) over the lists that returned it
}

/** Keyword ids are inserted first and the sort is stable, so ties break the way Python's dict
 *  insertion order plus sorted() break them. */
export function fuse(kwIds: string[], vecIds: string[], k: number, rrfK: number): Ranked[] {
  const byId = new Map<string, Ranked>();
  const add = (ids: string[], key: "kw" | "vec") =>
    ids.forEach((id, rank) => {
      const r = byId.get(id) ?? { id, kw: null, vec: null, fused: 0 };
      r[key] = rank + 1;
      r.fused += 1 / (rrfK + rank + 1);
      byId.set(id, r);
    });
  add(kwIds, "kw");
  add(vecIds, "vec");
  return [...byId.values()].sort((a, b) => b.fused - a.fused).slice(0, k);
}
