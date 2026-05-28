'use client';

import { useEffect, useState } from 'react';

/**
 * Swardly splash / loading screen.
 *
 * Shows the full-screen brand image (sunset field + wordmark + tagline)
 * on app load, holds for a deliberate beat so the brand registers, then
 * fades out to reveal the app.
 *
 * Behaviour:
 *  - Shows once per browser session (sessionStorage flag), so navigating
 *    around the app or re-rendering doesn't re-trigger it, but a fresh
 *    launch / new session does.
 *  - Hold duration ~1.8s, then a 500ms fade.
 *  - Pointer-events disabled during fade so it never blocks a tap.
 *  - Respects prefers-reduced-motion: skips the fade, just hides.
 *
 * The image itself (public/splash.jpg) carries the wordmark and tagline,
 * so this component only overlays a live progress bar aligned with where
 * the static bar sits in the artwork.
 */

const SESSION_KEY = 'swardly_splash_shown';
const HOLD_MS = 1800;
const FADE_MS = 500;

export function SplashScreen() {
  // Start hidden; decide in effect whether to show (avoids SSR/client flash
  // and respects the once-per-session rule).
  const [phase, setPhase] = useState<'hidden' | 'visible' | 'fading'>('hidden');

  useEffect(() => {
    // Only in the browser. If we've already shown it this session, skip.
    let alreadyShown = false;
    try {
      alreadyShown = sessionStorage.getItem(SESSION_KEY) === '1';
    } catch {
      // sessionStorage can throw in some privacy modes — just show it.
      alreadyShown = false;
    }
    if (alreadyShown) return;

    setPhase('visible');
    try { sessionStorage.setItem(SESSION_KEY, '1'); } catch { /* ignore */ }

    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    const holdTimer = setTimeout(() => {
      if (reduce) {
        setPhase('hidden');
      } else {
        setPhase('fading');
        const fadeTimer = setTimeout(() => setPhase('hidden'), FADE_MS);
        // Cleanup nested timer
        return () => clearTimeout(fadeTimer);
      }
    }, HOLD_MS);

    return () => clearTimeout(holdTimer);
  }, []);

  if (phase === 'hidden') return null;

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        backgroundColor: '#2B4129',
        backgroundImage: 'url(/splash.jpg)',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        opacity: phase === 'fading' ? 0 : 1,
        transition: `opacity ${FADE_MS}ms ease`,
        pointerEvents: phase === 'fading' ? 'none' : 'auto',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
      }}
    >
      {/* Live progress bar — sits near the bottom, roughly where the static
          bar appears in the artwork. Fills across the hold duration. */}
      <div
        style={{
          position: 'absolute',
          bottom: '11%',
          left: '50%',
          transform: 'translateX(-50%)',
          width: '34%',
          maxWidth: 220,
          height: 3,
          borderRadius: 3,
          background: 'rgba(255,255,255,0.28)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: '100%',
            borderRadius: 3,
            background: 'rgba(255,255,255,0.92)',
            transformOrigin: 'left center',
            animation: `swardly-splash-fill ${HOLD_MS}ms ease-out forwards`,
          }}
        />
      </div>

      <style>{`
        @keyframes swardly-splash-fill {
          from { transform: scaleX(0); }
          to   { transform: scaleX(1); }
        }
      `}</style>
    </div>
  );
}
