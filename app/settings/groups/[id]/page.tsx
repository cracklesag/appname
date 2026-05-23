import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Header } from '@/components/Header';
import { GroupMembershipEditor } from '@/components/GroupMembershipEditor';
import { loadGroups, loadFields } from '@/lib/data';

export const dynamic = 'force-dynamic';

export default async function GroupDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [groups, fields] = await Promise.all([loadGroups(), loadFields()]);
  const group = groups.find((g) => g.id === params.id);
  if (!group) notFound();

  return (
    <div style={{ paddingBottom: 80 }}>
      <Header
        title={group.name}
        subtitle="Field membership"
        backHref="/settings/groups"
      />
      <GroupMembershipEditor
        group={group}
        fields={fields}
        groups={groups}
      />
    </div>
  );
}
