'use client';

import { useEffect, useState } from 'react';
import { Bell, BellOff } from 'lucide-react';
import { savePushSubscription, deletePushSubscription } from '@/lib/actions';

const VAPID = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';

function urlBase64ToUint8Array(base64String: string): BufferSource {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const arr = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

type State = 'loading' | 'unsupported' | 'unconfigured' | 'denied' | 'off' | 'on' | 'working';

export function NotificationToggle() {
  const [state, setState] = useState<State>('loading');
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const supported = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
      if (!supported) { setState('unsupported'); return; }
      if (!VAPID) { setState('unconfigured'); return; }
      if (Notification.permission === 'denied') { setState('denied'); return; }
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        setState(sub ? 'on' : 'off');
      } catch { setState('off'); }
    })();
  }, []);

  async function enable() {
    setMsg(null);
    setState('working');
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { setState(perm === 'denied' ? 'denied' : 'off'); return; }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID) });
      const res = await savePushSubscription(JSON.stringify(sub));
      if (res.ok) setState('on'); else { setState('off'); setMsg('Could not save the subscription — try again.'); }
    } catch (e) {
      setState('off');
      setMsg(e instanceof Error ? e.message : 'Could not turn on alerts.');
    }
  }

  async function disable() {
    setMsg(null);
    setState('working');
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) { await deletePushSubscription(sub.endpoint); await sub.unsubscribe(); }
      setState('off');
    } catch { setState('off'); }
  }

  const card: React.CSSProperties = { padding: 14, marginBottom: 4 };

  if (state === 'loading') return null;

  return (
    <div className="card" style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
        {state === 'on' ? <Bell size={18} style={{ color: 'var(--forest)' }} /> : <BellOff size={18} style={{ color: 'var(--muted)' }} />}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>Job alerts</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
            {state === 'on' && 'On — you\u2019ll be notified when a job is sent to you.'}
            {state === 'off' && 'Get a notification when a new job arrives.'}
            {state === 'working' && 'One moment…'}
            {state === 'denied' && 'Blocked in your browser settings — allow notifications for this site to turn them on.'}
            {state === 'unsupported' && 'On iPhone, add Swardly to your home screen first, then alerts can be turned on.'}
            {state === 'unconfigured' && 'Not set up on this server yet.'}
          </div>
        </div>
        {(state === 'off' || state === 'on') && (
          <button type="button" onClick={state === 'on' ? disable : enable} className={state === 'on' ? 'btn-ghost' : 'btn-primary'} style={{ flexShrink: 0, padding: '8px 14px' }}>
            {state === 'on' ? 'Turn off' : 'Turn on'}
          </button>
        )}
      </div>
      {msg && <div style={{ fontSize: 12, color: 'var(--clay, #b06a37)', marginTop: 8 }}>{msg}</div>}
    </div>
  );
}
