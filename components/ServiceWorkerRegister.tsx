'use client';

import { useEffect } from 'react';

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    // Only register in production to avoid dev-time caching surprises
    if (process.env.NODE_ENV !== 'production') return;
    navigator.serviceWorker.register('/sw.js').catch(() => { /* silent */ });
  }, []);
  return null;
}
