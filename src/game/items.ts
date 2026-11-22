// The placed items (signs, lights, poles, lines, trees, lamps). Where they come from, in order:
// 1. a workspace named in the link (?ws=name), 2. the published map (only the admin can change it), 3. the file shipped with the site.
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
  const published = await loadWorkspace('published').catch(() => null);
  if (published && isItemsFile(published.data)) return published.data;
  const url = `${import.meta.env.BASE_URL}items/default.json`;
  const shipped = await fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return isItemsFile(shipped) ? shipped : null;
}
