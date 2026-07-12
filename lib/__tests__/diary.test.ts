import { describe, it, expect } from 'vitest';
import { buildDiaryEvents, eventsByDay, type DiaryLayerKey } from '@/lib/diary';
import type { Application, Cut, Job, Product, Todo } from '@/lib/types';

const prod = (id: number, name: string, type: string): Product =>
  ({ id, name, type } as unknown as Product);

const app = (id: string, fieldId: string, productId: number, date: string): Application =>
  ({ id, field_id: fieldId, product_id: productId, date_applied: date, coverage: 'whole' } as unknown as Application);

const cut = (id: string, fieldId: string, n: number, date: string): Cut =>
  ({ id, field_id: fieldId, cut_number: n, cut_date: date } as unknown as Cut);

const job = (id: string, title: string, status: string, due: string | null, approvedAt: string | null): Job =>
  ({ id, title, status, due_date: due, approved_at: approvedAt } as unknown as Job);

const todo = (id: string, title: string, due: string | null, doneAt: string | null): Todo =>
  ({ id, title, due_date: due, done_at: doneAt } as unknown as Todo);

const NAME = (id: string) => ({ f1: '13 Acre', f2: 'Broadacre' }[id] ?? id);

describe('buildDiaryEvents', () => {
  const products = [prod(1, 'Dairy slurry', 'slurry'), prod(2, 'CAN+S', 'bag_fert'), prod(3, 'Ground lime', 'lime'), prod(4, 'FYM', 'solid_manure')];

  it('maps products to the right layers (manure/fert/lime)', () => {
    const evs = buildDiaryEvents({
      applications: [app('a', 'f1', 1, '2026-07-01'), app('b', 'f1', 2, '2026-07-02'), app('c', 'f1', 3, '2026-07-03'), app('d', 'f1', 4, '2026-07-04')],
      cuts: [], jobs: [], todos: [], products, fieldName: NAME,
    });
    expect(evs.map((e) => e.layer)).toEqual(['manure', 'fert', 'lime', 'manure']);
    expect(evs[0].label).toBe('13 Acre — Dairy slurry');
  });

  it('jobs: open jobs sit on due_date, approved jobs on approved_at, undated skipped', () => {
    const evs = buildDiaryEvents({
      applications: [], cuts: [], todos: [], products, fieldName: NAME,
      jobs: [
        job('j1', 'Spread fert', 'sent', '2026-07-10', null),
        job('j2', 'Spray docks', 'approved', '2026-07-01', '2026-07-05T10:00:00Z'),
        job('j3', 'No date', 'draft', null, null),
      ],
    });
    expect(evs).toHaveLength(2);
    expect(evs.find((e) => e.key === 'job-j1')!.date).toBe('2026-07-10');
    expect(evs.find((e) => e.key === 'job-j2')!.date).toBe('2026-07-05');
    expect(evs.find((e) => e.key === 'job-j2')!.label).toContain('(done)');
  });

  it('to-dos: only dated ones land on the grid; done ones show a tick', () => {
    const evs = buildDiaryEvents({
      applications: [], cuts: [], jobs: [], products, fieldName: NAME,
      todos: [todo('t1', 'Order fert', '2026-07-09', null), todo('t2', 'Fix gate', null, null), todo('t3', 'Wash tank', '2026-07-08', '2026-07-08T12:00:00Z')],
    });
    expect(evs).toHaveLength(2);
    expect(evs.find((e) => e.key === 'todo-t3')!.label.startsWith('✓')).toBe(true);
  });

  it('cuts land on the cuts layer with the field name', () => {
    const evs = buildDiaryEvents({
      applications: [], jobs: [], todos: [], products, fieldName: NAME,
      cuts: [cut('c1', 'f2', 2, '2026-06-20')],
    });
    expect(evs[0]).toMatchObject({ layer: 'cuts', date: '2026-06-20', label: 'Broadacre — Cut 2' });
  });

  it('eventsByDay respects the visible-layer filter', () => {
    const evs = buildDiaryEvents({
      applications: [app('a', 'f1', 1, '2026-07-01')], cuts: [cut('c1', 'f1', 1, '2026-07-01')],
      jobs: [], todos: [], products, fieldName: NAME,
    });
    const all = eventsByDay(evs, new Set<DiaryLayerKey>(['manure', 'cuts']));
    expect(all.get('2026-07-01')).toHaveLength(2);
    const onlyCuts = eventsByDay(evs, new Set<DiaryLayerKey>(['cuts']));
    expect(onlyCuts.get('2026-07-01')).toHaveLength(1);
    expect(onlyCuts.get('2026-07-01')![0].layer).toBe('cuts');
  });
});
