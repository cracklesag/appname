import React from 'react';

/**
 * Skeleton primitives for route-level loading shells (loading.tsx). These render
 * instantly on navigation — the page frame and shimmer placeholders appear at
 * once, then Next streams in the real server-rendered content when the data
 * resolves. Purely presentational server components (no client JS).
 */

export function SkeletonBlock({
  w = '100%',
  h = 14,
  r,
  style,
}: {
  w?: number | string;
  h?: number | string;
  r?: number;
  style?: React.CSSProperties;
}) {
  return <span className="skeleton-block" style={{ width: w, height: h, borderRadius: r, ...style }} />;
}

export function SkeletonHeader({ withBack = true }: { withBack?: boolean }) {
  return (
    <div className="page-header">
      <div className="page-header-row">
        {withBack && <SkeletonBlock w={26} h={26} r={8} style={{ marginLeft: -4, marginRight: 10, flexShrink: 0 }} />}
        <div style={{ flex: 1 }}>
          <SkeletonBlock w={150} h={22} />
        </div>
      </div>
    </div>
  );
}

export function SkeletonCard({ lines = 2 }: { lines?: number }) {
  return (
    <div className="card" style={{ padding: 14, marginBottom: 10 }}>
      <SkeletonBlock w="55%" h={16} style={{ marginBottom: 12 }} />
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonBlock
          key={i}
          w={i === lines - 1 ? '40%' : '88%'}
          h={11}
          style={{ marginBottom: i === lines - 1 ? 0 : 9 }}
        />
      ))}
    </div>
  );
}

export function PageSkeleton({
  cards = 5,
  withBack = true,
  cardLines = 2,
}: {
  cards?: number;
  withBack?: boolean;
  cardLines?: number;
}) {
  return (
    <div style={{ paddingBottom: 80 }}>
      <SkeletonHeader withBack={withBack} />
      <div style={{ padding: '6px 16px 16px' }}>
        {Array.from({ length: cards }).map((_, i) => (
          <SkeletonCard key={i} lines={cardLines} />
        ))}
      </div>
    </div>
  );
}
