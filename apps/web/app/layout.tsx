// What: Root layout — fonts, metadata, theme provider, global CSS
// Why: Single place for app-wide concerns (fonts, meta, providers)
// Does NOT: Contain page-specific logic or feature components

import type { Metadata, Viewport } from 'next';
import { Fraunces, Plus_Jakarta_Sans } from 'next/font/google';
import { ThemeProvider } from '@/components/ThemeProvider';
import { Providers } from './providers';
import './globals.css';

const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-lalista-display',
  display: 'swap',
  weight: ['300', '400', '600'],
  style: ['normal', 'italic'],
});

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-lalista-body',
  display: 'swap',
  weight: ['400', '500', '600'],
});

export const metadata: Metadata = {
  title: 'lalista',
  description: 'Voice-first bilingual grocery list',
  manifest: '/manifest.json',
  // Next's metadata API does NOT auto-link /public/apple-touch-icon.png
  // (only the app/apple-icon.png convention). Without this, iOS uses a
  // screenshot for the home-screen icon when "Add to Home Screen" fires.
  icons: {
    apple: '/apple-touch-icon.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'lalista',
  },
};

export const viewport: Viewport = {
  themeColor: '#D4603A',
  width: 'device-width',
  initialScale: 1,
  // viewport-fit=cover is required for full-bleed PWA on notched iOS
  // devices; without it Safari leaves white safe-area bars that look
  // like the browser frame is leaking through.
  viewportFit: 'cover',
};

/**
 *
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${plusJakartaSans.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider>
          <Providers>{children}</Providers>
        </ThemeProvider>
      </body>
    </html>
  );
}
