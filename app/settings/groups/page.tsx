import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Header } from '@/components/Header';
import { GroupsManager } from '@/components/GroupsManager';
import { loadGroups, loadFields } from '@/lib/data';

export const dynamic = 'force-dynamic';

export default async function GroupsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [groups, fields] = await Promise.all([loadGroups(), loadFields()]);

  // Field-count per group — small enough to compute on the server in one pass.
  const fieldCountByGroup: Record<string, number> = {};
  let ungroupedCount = 0;
  for (const f of fields) {
    if (f.group_id) {
      fieldCountByGroup[f.group_id] = (fieldCountByGroup[f.group_id] ?? 0) + 1;
    } else {
      ungroupedCount++;
    }
  }

  return (
    <div style={{ paddingBottom: 80 }}>
      <Header title="Groups" subtitle="Blocks of land" backHref="/settings" />
      <GroupsManager
        groups={groups}
        fieldCountByGroup={fieldCountByGroup}
        ungroupedCount={ungroupedCount}
      />
    </div>
  );
}
