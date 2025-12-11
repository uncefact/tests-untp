import type { Metadata } from 'next';
import localFont from 'next/font/local';
import Script from 'next/script';
import { ClientLayout } from '@/components/ClientLayout';

import './globals.css';

const geistSans = localFont({
  src: './fonts/GeistVF.woff',
  variable: '--font-geist-sans',
  weight: '100 900',
});
const geistMono = localFont({
  src: './fonts/GeistMonoVF.woff',
  variable: '--font-geist-mono',
  weight: '100 900',
});

export const metadata: Metadata = {
  title: 'UNTP Playground',
  description: 'A playground for UNTP',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang='en'>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <ClientLayout>{children}</ClientLayout>

        {/* Dependencies for untp-test-suite-mocha */}
        <Script src='https://unpkg.com/chai@4.3.10/chai.js' strategy='beforeInteractive' />
        <Script src='https://unpkg.com/mocha@10.2.0/mocha.js' strategy='beforeInteractive' />
        <Script src='https://cdnjs.cloudflare.com/ajax/libs/ajv/8.17.1/ajv2020.bundle.min.js' strategy='beforeInteractive' />
        <Script src='https://unpkg.com/jsonld@8/dist/jsonld.min.js' strategy='beforeInteractive' />
        <Script src='https://eyereasoner.github.io/eye-js/18/latest/index.js' strategy='beforeInteractive' />
      </body>
    </html>
  );
}
