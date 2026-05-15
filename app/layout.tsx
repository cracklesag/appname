import type { Metadata, Viewport } from 'next';
import './globals.css';
import { BottomNav } from '@/components/BottomNav';
import { ServiceWorkerRegister } from '@/components/ServiceWorkerRegister';

export const metadata: Metadata = {
  title: 'APP_NAME',
  description: 'Fertiliser, slurry and cut tracking — field by field.',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'APP_NAME',
  },
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }],
  },
};

export const viewport: Viewport = {
  themeColor: '#3B5A3A',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body>
        <div className="app-shell">{children}</div>
        <BottomNav />
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
