import { PageSkeleton } from '@/components/Skeleton';

// Root loading shell. Shown instantly on navigation while a route's server data
// streams in. Acts as the fallback for any route without its own loading.tsx.
export default function Loading() {
  return <PageSkeleton withBack={false} cards={5} />;
}
