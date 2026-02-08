
import type { Metadata } from 'next';
import './globals.css';
import { cn } from '@/lib/utils';
import RootProvider from '@/components/providers/root-provider';

export const metadata: Metadata = {
  title: 'LlineStream',
  description: '프리미엄 비디오 스트리밍',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
        <link
          rel="stylesheet"
          as="style"
          crossOrigin="anonymous"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css"
        />
      </head>
      <body className={cn('min-h-screen bg-background font-body antialiased')}>
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
