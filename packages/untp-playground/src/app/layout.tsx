import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { ClientLayout } from '@/components/ClientLayout';
import type { RuntimeConfig } from '@/contexts/RuntimeConfigContext';
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

export async function generateMetadata(): Promise<Metadata> {
  const title = process.env.SITE_TITLE || 'UNTP Playground';
  const description = process.env.SITE_DESCRIPTION || 'A playground for UNTP';
  const faviconUrl = process.env.FAVICON_URL;

  return {
    title,
    description,
    ...(faviconUrl && {
      icons: { icon: faviconUrl },
    }),
  };
}

function getRuntimeConfig(): RuntimeConfig {
  return {
    headerTitle: process.env.HEADER_TITLE || 'UNTP Playground',
    verificationServiceUrl:
      process.env.VERIFICATION_SERVICE_URL ||
      'https://vckit.untp.showthething.com/agent/routeVerificationCredential',
    verificationServiceToken: process.env.VERIFICATION_SERVICE_TOKEN || 'test123',
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const runtimeConfig = getRuntimeConfig();

  return (
    <html lang='en'>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <ClientLayout runtimeConfig={runtimeConfig}>{children}</ClientLayout>
      </body>
    </html>
  );
}
