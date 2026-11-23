// The local cache of each document (in this browser): what was last loaded or changed, and whether the
// newest change has reached the server. The server copy is the real one; this copy covers a reload or a
// lost connection until the change is sent.
import { kvGet, kvSet } from '../shared/db';

export interface DocCache {
  name: string;
  title: string;
  recs: unknown[];
  savedAt: string;
  /** a change that has not reached the server yet */
  dirty: boolean;
}

export const readCache = (name: string) => kvGet<DocCache>(`doc:${name}`);
export const writeCache = (c: DocCache) => kvSet(`doc:${c.name}`, c);

/** A project file the builder can open: the format and a list of items. */
export function isSession(v: unknown): v is { format: 'krug-builder-session'; recs: unknown[] } {
  return !!v && typeof v === 'object' && (v as { format?: string }).format === 'krug-builder-session' && Array.isArray((v as { recs?: unknown }).recs);
}
