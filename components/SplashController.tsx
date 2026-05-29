'use client';

import { useEffect } from 'react';

/**
 * Tears down the first-paint splash (#swardly-splash, static HTML in the
 * server layout). The VISUAL fade is handled entirely by CSS
 * (swardly-splash-auto in globals.css), which guarantees the overlay fades
 * and becomes non-interactive even if this never runs. This component's only
 * jobs are: (1) on a repeat visit within the session, hide the splash
 * instantly rather than replaying it; (2) remove the DOM node after it has
 * faded, to keep the tree clean.
 *
 * Because the CSS owns the fade, this can't cause a hang — worst case the
 * node lingers invisibly and non-interactively, which is harmless.
 */

const TOTAL_MS = 2300 + 500 + 100; // hold + fade + buffer

export function SplashController() {
  useEffect(() => {
    const el = document.getElementById('swardly-splash');
    if (!el) return;

    let shown = false;
    try {
      shown = sessionStorage.getItem('swardly_splash_shown') === '1';
    } catch {
      shown = false;
    }

    if (shown) {
      el.remove();
      return;
    }

    try {
      sessionStorage.setItem('swardly_splash_shown', '1');
    } catch {
      /* ignore */
    }

    const t = setTimeout(() => el.remove(), TOTAL_MS);
    return () => clearTimeout(t);
  }, []);

  return null;
}
