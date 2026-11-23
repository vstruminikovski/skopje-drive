// The three local workspaces of the builder. Each keeps its items and its history in this browser
// (IndexedDB), so it is still there after a reload, and changes are kept as you work.
import { kvGet, kvSet } from '../shared/db';

export const SLOT_COUNT = 3;

export interface Slot {
  name: string;
  savedAt: string;
  recs: unknown[];
  nextId: number;
  /** the steps of the history, and the step you are on */
  history: unknown[];
  histAt: number;
  /** changed since the last save to your account */
  unsaved: boolean;
}

export async function readSlot(i: number): Promise<Slot | null> {
  return kvGet<Slot>(`slot:${i}`);
}

export async function writeSlot(i: number, s: Slot): Promise<void> {
  await kvSet(`slot:${i}`, s);
}

/** A project file the builder can open: the format and a list of items. */
export function isSession(v: unknown): v is { format: 'krug-builder-session'; recs: unknown[] } {
  return !!v && typeof v === 'object' && (v as { format?: string }).format === 'krug-builder-session' && Array.isArray((v as { recs?: unknown }).recs);
}
