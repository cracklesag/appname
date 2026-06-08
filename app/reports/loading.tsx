import { PageSkeleton } from '@/components/Skeleton';

// Covers every /reports/* page.
export default function Loading() {
  return <PageSkeleton withBack cards={4} cardLines={3} />;
}
