import type { Metadata, Viewport } from 'next';
import './globals.css';
import { BottomNav } from '@/components/BottomNav';
import { ServiceWorkerRegister } from '@/components/ServiceWorkerRegister';
import { SplashScreen } from '@/components/SplashScreen';

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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body>
        <SplashScreen />
        <div className="app-shell">{children}</div>
        <BottomNav />
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
