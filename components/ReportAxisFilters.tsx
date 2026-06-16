import { FilterChips } from '@/components/FilterChips';
import { SlidersHorizontal } from 'lucide-react';
import type { ChipOption } from '@/lib/grouping';

/**
 * Type + agreement filter chips for report pages. The block axis stays in each
 * report's own shell (its existing group filter); these two are applied by the
 * page pre-filtering rows server-side. Collapsed by default, open while active.
 * Renders nothing if neither axis has a value worth filtering.
 */
export function ReportAxisFilters({
  typeOptions, agreementOptions, typeValue, agreementValue,
}: {
  typeOptions: ChipOption[];
  agreementOptions: ChipOption[];
  typeValue: string;
  agreementValue: string;
}) {
  const showType = typeOptions.length >= 2;
  const showAgreement = agreementOptions.length >= 2;
  if (!showType && !showAgreement) return null;
  const active = (typeValue && typeValue !== 'all') || (agreementValue && agreementValue !== 'all');

  return (
    <div style={{ padding: '12px 16px 0' }}>
      <details open={!!active}>
        <summary style={{ cursor: 'pointer', fontSize: 12.5, fontWeight: 700, color: 'var(--forest-dark)', listStyle: 'none', display: 'inline-flex', alignItems: 'center', gap: 6, padding: '2px 0' }}>
          <SlidersHorizontal size={14} /> Filter by land{active ? ' · active' : ''}
        </summary>
        <div style={{ marginTop: 8 }}>
          {showType && <FilterChips paramName="type" ariaLabel="Filter by allocation type" options={typeOptions} />}
          {showAgreement && <FilterChips paramName="agreement" ariaLabel="Filter by agreement" options={agreementOptions} />}
        </div>
      </details>
    </div>
  );
}
