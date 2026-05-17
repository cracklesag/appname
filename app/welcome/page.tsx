import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { loadSettings } from '@/lib/data';
import { WelcomeForm } from './WelcomeForm';

export const dynamic = 'force-dynamic';

export default async function WelcomePage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // If already onboarded, skip straight to the app
  const settings = await loadSettings();
  if (settings.onboarded) redirect('/');

  return <WelcomeForm />;
}
