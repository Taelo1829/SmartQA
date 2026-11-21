import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'SmartQA — Autonomous QA console',
    template: '%s · SmartQA',
  },
  description:
    'SmartQA explores your web app autonomously, validates filters and arithmetic, and reports evidence-backed findings with reproduction steps.',
  applicationName: 'SmartQA',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#070a0f',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
