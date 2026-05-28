import type { Metadata, Viewport } from 'next';
import './globals.css';
import { BottomNav } from '@/components/BottomNav';
import { ServiceWorkerRegister } from '@/components/ServiceWorkerRegister';

export const metadata: Metadata = {
  title: 'Swardly',
  description: 'Know your fields. Plan your future. Fertiliser, slurry and cut tracking — field by field.',
  manifest: '/manifest.webmanifest',
  metadataBase: new URL('https://swardly.co.uk'),
  applicationName: 'Swardly',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Swardly',
  },
  icons: {
    icon: [
      { url: '/icons/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }],
  },
};

export const viewport: Viewport = {
  themeColor: '#2B4129',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

/**
 * Splash is rendered directly in the server HTML (not a client component)
 * so the browser paints it on the very first frame — before React hydrates
 * and before any app content can flash behind it. A tiny inline script
 * holds it for a beat, then fades and removes it. The once-per-session
 * guard means in-app navigation doesn't re-trigger it.
 *
 * Inlined (not external) so there's zero round-trip before it shows.
 */
const SPLASH_HOLD_MS = 1800;
const SPLASH_FADE_MS = 500;

const splashScript = `
(function(){
  try {
    if (sessionStorage.getItem('swardly_splash_shown') === '1') {
      var el = document.getElementById('swardly-splash');
      if (el) el.parentNode.removeChild(el);
      return;
    }
    sessionStorage.setItem('swardly_splash_shown','1');
  } catch(e) {}
  var reduce = false;
  try { reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch(e){}
  function go(){
    var el = document.getElementById('swardly-splash');
    var bar = document.getElementById('swardly-splash-bar');
    if (bar) { bar.style.transform = 'scaleX(1)'; }
    setTimeout(function(){
      if (!el) return;
      if (reduce) { el.parentNode && el.parentNode.removeChild(el); return; }
      el.style.opacity = '0';
      el.style.pointerEvents = 'none';
      setTimeout(function(){ el.parentNode && el.parentNode.removeChild(el); }, ${SPLASH_FADE_MS});
    }, ${SPLASH_HOLD_MS});
  }
  if (document.readyState === 'complete' || document.readyState === 'interactive') { go(); }
  else { window.addEventListener('DOMContentLoaded', go); }
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <head>
        <link rel="preload" as="image" href="/splash.jpg" />
      </head>
      <body>
        {/* Splash — first paint, before hydration. Removed by the inline
            script below after the hold. */}
        <div
          id="swardly-splash"
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
            opacity: 1,
            transition: `opacity ${SPLASH_FADE_MS}ms ease`,
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
          }}
        >
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
              id="swardly-splash-bar"
              style={{
                height: '100%',
                width: '100%',
                borderRadius: 3,
                background: 'rgba(255,255,255,0.92)',
                transformOrigin: 'left center',
                transform: 'scaleX(0)',
                transition: `transform ${SPLASH_HOLD_MS}ms ease-out`,
              }}
            />
          </div>
        </div>
        <script dangerouslySetInnerHTML={{ __html: splashScript }} />

        <div className="app-shell">{children}</div>
        <BottomNav />
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
