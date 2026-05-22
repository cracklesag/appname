'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';

export type FilterOption = {
  /** URL value. Use '' for the "all" / default option. */
  value: string;
  label: string;
};

/**
 * Horizontal chip row whose state lives in URL search params.
 *
 * - Selected chip is the param's current value (or the first option if the
 *   param is absent).
 * - Tapping a chip updates the URL via shallow router replace, preserving
 *   other params already in the URL.
 * - Setting the param to its default (first option's value, typically '')
 *   removes the param from the URL to keep it tidy.
 */
export function FilterChips({
  paramName,
  options,
  ariaLabel,
}: {
  paramName: string;
  options: FilterOption[];
  ariaLabel?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const defaultValue = options[0]?.value ?? '';
  const current = searchParams.get(paramName) ?? defaultValue;

  const select = useCallback(
    (value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value === defaultValue) {
        params.delete(paramName);
      } else {
        params.set(paramName, value);
      }
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [searchParams, defaultValue, paramName, router, pathname]
  );

  return (
    <div
      className="toggle-group"
      role="group"
      aria-label={ariaLabel}
      style={{
        flexWrap: 'wrap',
        gap: 6,
        marginBottom: 12,
      }}
    >
      {options.map((opt) => (
        <button
          key={opt.value || '_default'}
          type="button"
          className={`toggle-btn ${current === opt.value ? 'active' : ''}`}
          onClick={() => select(opt.value)}
          style={{ fontSize: 13, padding: '6px 12px' }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
