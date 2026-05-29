import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { Header } from '@/components/Header';
import { loadFields, loadGroups } from '@/lib/data';
import { displayFieldArea } from '@/lib/rules';
import { loadSettings } from '@/lib/data';

export const dynamic = 'force-dynamic';

/**
 * Top-level "Log action" application entry point. Reached from the home-screen
 * Log action menu (Fertiliser / Slurry / Solid manure / Lime). The application
 * form is field-scoped, so this is a quick field picker that forwards to
 * /fields/[id]/log carrying the chosen product type.
 *
 * Cut logging uses /cuts/batch directly (it has its own multi-field picker),
 * so this route only handles applications.
 */
const VALID_TYPES = ['bag_fert', 'slurry', 'solid_manure', 'lime'] as const;
type LogType = (typeof VALID_TYPES)[number];

const TYPE_LABEL: Record<LogType, string> = {
  bag_fert: 'Fertiliser',
  slurry: 'Slurry',
  solid_manure: 'Solid manure',
  lime: 'Lime',
};

export default async function LogPickerPage({
  searchParams,
}: {
  searchParams: { type?: string };
}) {
  const rawType = searchParams.type ?? '';
  const type: LogType = (VALID_TYPES as readonly string[]).includes(rawType)
    ? (rawType as LogType)
    : 'bag_fert';

  const [fields, groups, settings] = await Promise.all([
    loadFields(),
    loadGroups(),
    loadSettings(),
  ]);

  const groupName = new Map(groups.map((g) => [g.id, g.name]));
  const sorted = [...fields].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div style={{ paddingBottom: 80 }}>
      <Header
        title={`Log ${TYPE_LABEL[type].toLowerCase()}`}
        subtitle="Pick a field"
        backHref="/"
      />
      <div style={{ padding: '12px 16px' }}>
        {sorted.length === 0 && (
          <div style={{ color: 'var(--muted)', fontSize: 14, padding: '24px 0', textAlign: 'center' }}>
            No fields yet. Add a field first.
          </div>
        )}
        {sorted.map((f) => {
          const a = displayFieldArea(f, settings.unitSystem);
          return (
            <Link
              key={f.id}
              href={`/fields/${f.id}/log?type=${type}&from=/log?type=${type}`}
              className="card field-row"
              style={{ padding: '14px 16px', marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
            >
              <div>
                <div className="display" style={{ fontSize: 17, fontWeight: 500, color: 'var(--ink)' }}>{f.name}</div>
                <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>
                  {fmtArea(a)}{f.group_id && groupName.get(f.group_id) ? ` · ${groupName.get(f.group_id)}` : ''}
                </div>
              </div>
              <ChevronRight size={18} style={{ color: 'var(--stone)' }} />
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function fmtArea(a: { value: number; unit: string }): string {
  return `${a.value.toFixed(1)} ${a.unit}`;
}
