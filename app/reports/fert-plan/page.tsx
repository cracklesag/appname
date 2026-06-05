import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

// Retired: consolidated into the unified Plan (/plan). Kept as a redirect so any
// existing links/bookmarks still resolve. The old shell component remains in the
// tree (unused) so this is reversible.
export default function Page() {
  redirect('/plan');
}
