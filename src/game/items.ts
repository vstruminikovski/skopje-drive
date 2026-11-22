// The placed items (signs, lights, poles, lines, trees, lamps). The game shows what the builder saved in this browser;
// everyone else gets the published default file.
import { kvGet } from '../shared/db';
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

export async function loadItems(): Promise<ItemsFile | null> {
  const local = await kvGet<ItemsFile>('items').catch(() => null);
  if (isItemsFile(local)) return local;
  const url = `${import.meta.env.BASE_URL}items/default.json`;
  const published = await fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return isItemsFile(published) ? published : null;
}
