import { SkeletonHeader, SkeletonBlock } from '@/components/Skeleton';

// Map: header + a large shimmer panel where the satellite map will render.
export default function Loading() {
  return (
    <div style={{ paddingBottom: 80 }}>
      <SkeletonHeader withBack />
      <div style={{ padding: 16 }}>
        <SkeletonBlock w="100%" h="62vh" r={12} />
      </div>
    </div>
  );
}
