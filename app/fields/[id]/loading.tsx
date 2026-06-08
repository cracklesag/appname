import { SkeletonHeader, SkeletonBlock, SkeletonCard } from '@/components/Skeleton';

// Field detail: header, a tall overview/soil card, then a couple of cards.
export default function Loading() {
  return (
    <div style={{ paddingBottom: 80 }}>
      <SkeletonHeader withBack />
      <div style={{ padding: '6px 16px 16px' }}>
        <div className="card" style={{ padding: 14, marginBottom: 10 }}>
          <SkeletonBlock w="45%" h={16} style={{ marginBottom: 12 }} />
          <SkeletonBlock w="100%" h={56} r={8} style={{ marginBottom: 10 }} />
          <SkeletonBlock w="70%" h={11} />
        </div>
        <SkeletonCard lines={3} />
        <SkeletonCard lines={2} />
      </div>
    </div>
  );
}
