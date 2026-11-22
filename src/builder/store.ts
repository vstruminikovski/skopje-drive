// The builder's own work (items, versions, surveyor) between visits. Kept in the app's shared store.
import { kvGet, kvSet } from '../shared/db';

export interface Session {
  format: 'krug-builder-session';
  version: 1;
  savedAt: string;
  surveyor: string;
  nextId: number;
  recs: unknown[];
  versions: unknown[];
}

const KEY = 'session';

export function isSession(v: unknown): v is Session {
  return !!v && typeof v === 'object' && (v as Session).format === 'krug-builder-session' && Array.isArray((v as Session).recs);
}

export async function writeSession(s: Session): Promise<void> {
  await kvSet(KEY, s);
}

export async function readSession(): Promise<Session | null> {
  const v = await kvGet<Session>(KEY);
  return isSession(v) ? v : null;
}
