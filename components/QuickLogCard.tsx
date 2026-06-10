'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LocateFixed } from 'lucide-react';
import { locateFieldAtPoint, bboxOfGeometry, centroidOfBbox, type FieldGeometry, type LocatableField } from '@/lib/geo';

interface QLField { id: string; name: string; boundary: unknown | null; }

// "Log where I'm standing" — one tap in the cab: GPS fix -> which field am I
// in -> open that field. Location is used on-device only, never stored.
export function QuickLogCard({ fields }: { fields: QLField[] }) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'locating' | 'error'>('idle');
  const [msg, setMsg] = useState<string | null>(null);

  const mapped = fields.filter((f) => f.boundary);
  if (mapped.length === 0) return null; // nothing to locate against

  function locate() {
    if (!('geolocation' in navigator)) { setState('error'); setMsg('Location not available on this device.'); return; }
    setState('locating');
    setMsg(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const locatable: LocatableField[] = mapped.map((f) => {
          const geometry = f.boundary as FieldGeometry;
          let centroid: { lng: number; lat: number } | null = null;
          try { centroid = centroidOfBbox(bboxOfGeometry(geometry)); } catch { /* skip */ }
          return { id: f.id, geometry, centroid };
        });
        const loc = locateFieldAtPoint([pos.coords.longitude, pos.coords.latitude], locatable);
        const targetId = loc.insideId ?? (loc.nearestMeters != null && loc.nearestMeters <= 150 ? loc.nearestId : null);
        if (targetId) {
          router.push(`/fields/${targetId}?from=/`);
        } else {
          setState('error');
          const acc = Math.round(pos.coords.accuracy);
          setMsg(`You don't seem to be in a mapped field (GPS accuracy ±${acc} m).`);
        }
      },
      (err) => {
        setState('error');
        setMsg(err.code === err.PERMISSION_DENIED ? 'Location is blocked — allow it for this site in your browser settings.' : 'Could not get a GPS fix — try again outside.');
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={locate}
        disabled={state === 'locating'}
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, padding: '13px 14px', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10, fontSize: 14, fontWeight: 700, color: 'var(--ink)', cursor: 'pointer', fontFamily: 'inherit' }}
      >
        <LocateFixed size={18} style={{ color: 'var(--forest)' }} />
        {state === 'locating' ? 'Finding your field…' : 'Log where I\u2019m standing'}
      </button>
      {state === 'error' && msg && (
        <div style={{ fontSize: 12, color: 'var(--clay, #b06a37)', marginTop: 6, textAlign: 'center' }}>{msg}</div>
      )}
    </div>
  );
}
