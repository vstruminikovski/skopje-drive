// The placed items (signs, lights, poles, lines, trees, lamps). Where they come from, in order:
// 1. a shared workspace named in the link (?ws=name), 2. what the builder saved in this browser, 3. the published default.
import { kvGet } from '../shared/db';
import { loadWorkspace } from '../shared/cloud';
import type { UserItem } from './render/userItems';

export const ITEMS_FORMAT = 'mapng-mod';
export const ITEMS_VERSION = 2;

export interface ItemsFile {
  format: typeof ITEMS_FORMAT;
  version: typeof ITEMS_VERSION;
  savedAt: string;
  surveyor: string;
  items: UserItem[];
}

export function isItemsFile(v: unknown): v is ItemsFile {
  const d = v as ItemsFile | null;
  return !!d && d.format === ITEMS_FORMAT && d.version === ITEMS_VERSION && Array.isArray(d.items);
}

export async function loadItems(ws?: string | null): Promise<ItemsFile | null> {
  if (ws) {
    const shared = await loadWorkspace(ws).catch(() => null);
    if (shared && isItemsFile(shared.data)) return shared.data;
  }
  const local = await kvGet<ItemsFile>('items').catch(() => null);
  if (isItemsFile(local)) return local;
  const url = `${import.meta.env.BASE_URL}items/default.json`;
  const published = await fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return isItemsFile(published) ? published : null;
}
