import webpush from 'web-push';
import { createServiceClient } from '@/lib/supabase/admin';

// Web push is dormant until VAPID keys are present in the environment:
//   NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY  (and optional VAPID_SUBJECT)
// Generate them once with:  npx web-push generate-vapid-keys
let configured: boolean | null = null;
function ensureConfigured(): boolean {
  if (configured !== null) return configured;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (pub && priv) {
    try {
      webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:info@swardly.co.uk', pub, priv);
      configured = true;
    } catch {
      configured = false;
    }
  } else {
    configured = false;
  }
  return configured;
}

export function pushEnabled(): boolean {
  return ensureConfigured();
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

// Send a push to every device a user has opted in on. Uses the service client
// (so one user's action can notify another). Never throws — push failures must
// not break the job action that triggered them.
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  if (!userId || !ensureConfigured()) return;
  try {
    const svc = createServiceClient();
    const { data } = await svc.from('push_subscriptions').select('id, endpoint, p256dh, auth').eq('user_id', userId);
    const subs = (data ?? []) as { id: string; endpoint: string; p256dh: string; auth: string }[];
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload));
        } catch (err) {
          const code = (err as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) await svc.from('push_subscriptions').delete().eq('id', s.id);
        }
      }),
    );
  } catch {
    /* swallow — never break the caller */
  }
}
