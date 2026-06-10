'use client';

// Offline write queue — Phase 1: spray records, job completions, shared-job
// submissions. Entries persist in IndexedDB and sync when signal returns.
// FormData is stored as string entry pairs (none of these forms carry files).

import { get, set } from 'idb-keyval';

const KEY = 'swardly-offline-queue-v1';
export const QUEUE_EVENT = 'swardly-queue-changed';

export type QueueKind = 'spray_record' | 'job_completion' | 'shared_job';

export interface QueueItem {
  id: string;
  kind: QueueKind;
  /** FormData entries for action-based kinds. */
  fd?: [string, string][];
  /** Plain args for shared_job: token, pin, completionsJson. */
  args?: Record<string, string>;
  createdAt: number;
  attempts: number;
  lastError?: string;
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `q-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function notify() {
  try { window.dispatchEvent(new Event(QUEUE_EVENT)); } catch { /* SSR no-op */ }
}

export async function listQueue(): Promise<QueueItem[]> {
  try { return ((await get(KEY)) as QueueItem[] | undefined) ?? []; } catch { return []; }
}

async function writeQueue(items: QueueItem[]): Promise<void> {
  try { await set(KEY, items); } catch { /* storage unavailable — nothing we can do */ }
  notify();
}

export function serializeFormData(fd: FormData): [string, string][] {
  const out: [string, string][] = [];
  fd.forEach((v, k) => { if (typeof v === 'string') out.push([k, v]); });
  return out;
}

export function rebuildFormData(entries: [string, string][]): FormData {
  const fd = new FormData();
  for (const [k, v] of entries) fd.append(k, v);
  return fd;
}

export async function enqueue(kind: QueueKind, payload: { fd?: FormData; args?: Record<string, string> }): Promise<void> {
  const items = await listQueue();
  items.push({
    id: newId(),
    kind,
    fd: payload.fd ? serializeFormData(payload.fd) : undefined,
    args: payload.args,
    createdAt: Date.now(),
    attempts: 0,
  });
  await writeQueue(items);
}

export async function updateQueue(items: QueueItem[]): Promise<void> {
  await writeQueue(items);
}

/** Heuristic: did this throw because we're offline / the request never landed? */
export function isOfflineError(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /fetch|network|load failed|failed to fetch|connection|timed?\s?out/i.test(msg);
}
