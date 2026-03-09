import type { Metadata } from 'next';
import localFont from 'next/font/local';
import type { ReactNode } from 'react';

import Providers from './providers';
import './globals.css';

const syne = localFont({
  src: [
    { path: './fonts/Syne-Regular.ttf', weight: '400', style: 'normal' },
    { path: './fonts/Syne-Medium.ttf', weight: '500', style: 'normal' },
    { path: './fonts/Syne-SemiBold.ttf', weight: '600', style: 'normal' },
    { path: './fonts/Syne-Bold.ttf', weight: '700', style: 'normal' },
    { path: './fonts/Syne-ExtraBold.ttf', weight: '800', style: 'normal' }
  ],
  variable: '--font-display',
  display: 'swap'
});

const jetBrainsMono = localFont({
  src: [
    { path: './fonts/JetBrainsMono-Regular.ttf', weight: '400', style: 'normal' },
    { path: './fonts/JetBrainsMono-Medium.ttf', weight: '500', style: 'normal' },
    { path: './fonts/JetBrainsMono-SemiBold.ttf', weight: '600', style: 'normal' },
    { path: './fonts/JetBrainsMono-Bold.ttf', weight: '700', style: 'normal' }
  ],
  variable: '--font-mono',
  display: 'swap'
});

export const metadata: Metadata = {
  title: 'MX402 Exchange',
  description: 'MultiversX-native pay-per-API marketplace for metered EGLD API payments'
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${syne.variable} ${jetBrainsMono.variable}`}>
      <body className="bg-background font-display text-ink antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
