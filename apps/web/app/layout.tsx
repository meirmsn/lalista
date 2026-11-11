// What: Root layout — fonts, metadata, theme provider, global CSS
// Why: Single place for app-wide concerns (fonts, meta, providers)
// Does NOT: Contain page-specific logic or feature components

import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { ThemeProvider } from '@/components/ThemeProvider';
import { Providers } from './providers';
import './globals.css';

// The fonts are files in ./fonts (Latin subset, variable weight, SIL OFL 1.1: see the OFL-*.txt
// beside them), the same files next/font/google used to download from Google at every build.
// Local files keep the build off the network (scripts/build.sh "reaches no other host") and end
// Turbopack's intermittent "next/font/google queries have exactly one entry" build failure.
// The weights the app uses: Fraunces 300, 400, 600 (normal and italic); Plus Jakarta Sans 400-600.
const fraunces = localFont({
  src: [
    {
      path: './fonts/Fraunces-latin.woff2',
      weight: '100 900',
      style: 'normal',
    },
    {
      path: './fonts/Fraunces-Italic-latin.woff2',
      weight: '100 900',
      style: 'italic',
    },
  ],
  variable: '--font-lalista-display',
  display: 'swap',
});

const plusJakartaSans = localFont({
  src: './fonts/PlusJakartaSans-latin.woff2',
  weight: '200 800',
  variable: '--font-lalista-body',
  display: 'swap',
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
