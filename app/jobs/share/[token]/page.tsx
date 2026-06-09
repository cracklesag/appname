import { SharedJobView } from '@/components/SharedJobView';

export const dynamic = 'force-dynamic';

export default function SharedJobPage({ params }: { params: { token: string } }) {
  return (
    <div style={{ maxWidth: 480, margin: '0 auto', background: 'var(--paper, #f7f4ee)' }}>
      <SharedJobView token={params.token} />
    </div>
  );
}
