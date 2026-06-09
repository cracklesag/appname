import type { Metadata, Viewport } from 'next';
import './globals.css';
import { BottomNav } from '@/components/BottomNav';
import { loadSettings, countNewJobs } from '@/lib/data';
import { ServiceWorkerRegister } from '@/components/ServiceWorkerRegister';
import { SplashController } from '@/components/SplashController';

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

/*
 * Splash: first-paint static HTML so the browser shows it on the very first
 * frame (no flash of the app behind it). Removal is driven by SplashController
 * (a client component whose useEffect is guaranteed to run). As a belt-and-
 * braces fallback, a pure-CSS animation also fades and disables the overlay
 * even if JS never runs — so the splash can NEVER hang permanently.
 *
 * The CSS animation runs once on load: hold opaque, then fade, then become
 * non-interactive (pointer-events:none) so it can't block the app even if the
 * element lingers in the DOM. SplashController removes the node entirely on
 * the normal path and handles once-per-session.
 */
const HOLD_MS = 2300;
const FADE_MS = 500;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const settings = await loadSettings();
  const accountType = settings.accountType ?? 'farm';
  const jobBadge = accountType === 'contractor' ? await countNewJobs() : 0;
  return (
    <html lang="en-GB">
      <head>
        <link rel="preload" as="image" href="/splash.jpg" />
      </head>
      <body>
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
            transition: `opacity ${FADE_MS}ms ease`,
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
            animation: `swardly-splash-auto ${HOLD_MS + FADE_MS}ms ease forwards`,
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
                animation: `swardly-splash-fill ${HOLD_MS}ms ease-out forwards`,
              }}
            />
          </div>
        </div>

        <SplashController />

        <div
          role="note"
          style={{
            background: 'var(--forest-dark, #2B4129)',
            color: 'var(--brand-cream, #efe7d6)',
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
            textAlign: 'center',
            padding: '4px 12px',
          }}
        >
          Closed beta · in testing
        </div>

        <div className="app-shell">{children}</div>
        <BottomNav accountType={accountType} jobBadge={jobBadge} />
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
