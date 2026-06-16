import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { Header } from '@/components/Header';
import { loadFields, loadGroups, loadAllocationTypes, loadAgreements, loadFieldAgreements } from '@/lib/data';
import { Layers, Tractor, FileBadge, ChevronRight } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function LandPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [fields, groups, types, agreements, links] = await Promise.all([
    loadFields(), loadGroups(), loadAllocationTypes(), loadAgreements(), loadFieldAgreements(),
  ]);

  const blocksInUse = new Set(fields.map((f) => f.group_id).filter(Boolean)).size;
  const typesInUse = new Set(fields.map((f) => f.allocation_type_id).filter(Boolean)).size;
  const agreementsInUse = new Set(links.map((l) => l.agreement_id)).size;
  const customTypes = types.filter((t) => t.user_id !== null).length;
  const customAgreements = agreements.filter((a) => a.user_id !== null).length;

  const rows = [
    {
      href: '/settings/groups', icon: <Layers size={18} style={{ color: 'var(--forest)' }} />,
      title: 'Blocks', sub: 'Physical blocks of land — one per field',
      meta: `${groups.length} block${groups.length === 1 ? '' : 's'} · ${blocksInUse} in use`,
    },
    {
      href: '/settings/allocation-types', icon: <Tractor size={18} style={{ color: 'var(--forest)' }} />,
      title: 'Allocation types', sub: 'How each field is run — silage, grazing, low input…',
      meta: `${types.length} type${types.length === 1 ? '' : 's'}${customTypes ? ` (${customTypes} custom)` : ''} · ${typesInUse} in use`,
    },
    {
      href: '/settings/agreements', icon: <FileBadge size={18} style={{ color: 'var(--amber)' }} />,
      title: 'Agreements', sub: 'SFI, stewardship & custom — many per field',
      meta: `${agreements.length} option${agreements.length === 1 ? '' : 's'}${customAgreements ? ` (${customAgreements} custom)` : ''} · ${agreementsInUse} in use`,
    },
  ];

  return (
    <div style={{ paddingBottom: 80 }}>
      <Header title="Land & groupings" subtitle="Three ways to organise fields" backHref="/settings" />

      <div style={{ padding: '12px 16px' }}>
        <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 16px', lineHeight: 1.55 }}>
          Each field sits on three independent axes — its <strong>block</strong> of land, the <strong>way it&rsquo;s run</strong>,
          and any <strong>agreements</strong> it&rsquo;s in. You can filter and colour the fields list and maps by any of them,
          and types &amp; agreements feed the composed advisory N cap on each field.
        </p>

        {rows.map((r) => (
          <Link key={r.href} href={r.href} className="card" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14, marginBottom: 10, textDecoration: 'none', color: 'inherit' }}>
            <div style={{ flexShrink: 0 }}>{r.icon}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{r.title}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{r.sub}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, fontWeight: 600 }}>{r.meta}</div>
            </div>
            <ChevronRight size={18} style={{ color: 'var(--muted)', flexShrink: 0 }} />
          </Link>
        ))}
      </div>
    </div>
  );
}
