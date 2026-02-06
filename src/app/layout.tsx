
'use client';

import type { Metadata } from 'next';
import './globals.css';
import { cn } from '@/lib/utils';
import { Toaster } from '@/components/ui/toaster';
import Header from '@/components/layout/header';
import Footer from '@/components/layout/footer';
import BottomNavBar from '@/components/layout/bottom-nav-bar';
import { FirebaseClientProvider, useUser } from '@/firebase';
import { CartProvider } from '@/context/cart-context';
import CartSidebar from '@/components/cart/cart-sidebar';
import { LandingPageProvider, useLandingPage } from '@/context/landing-page-context';
import { usePathname } from 'next/navigation';

// Since we are using hooks, Metadata object cannot be used here.
// We can set title dynamically in child components if needed.
// export const metadata: Metadata = {
//   title: 'LlineStream',
//   description: '프리미엄 비디오 스트리밍',
// };

function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { preference, isLandingPageLoading } = useLandingPage();
  const { user } = useUser();

  const isAdminPage = pathname.startsWith('/admin');

  // To prevent flash of incorrect component while loading preference
  if (isLandingPageLoading) {
    return (
      <div className="relative flex min-h-dvh flex-col bg-background">
        <Header />
        <main className="flex-1">{children}</main>
        <CartSidebar />
      </div>
    );
  }

  // '앱 버전'일 때의 레이아웃
  if (preference === 'original') {
    const showBottomNav = !isAdminPage && !!user;
    return (
      <div className="relative flex min-h-dvh flex-col bg-background">
        <Header />
        <main className={cn("flex-1", showBottomNav && "pb-16")}>{children}</main>
        {showBottomNav && <BottomNavBar />}
        <CartSidebar />
      </div>
    );
  }

  // '홈페이지 모드'일 때의 레이아웃
  const showFooter = !isAdminPage;
  return (
    <div className="relative flex min-h-dvh flex-col bg-background">
      <Header />
      <main className="flex-1">{children}</main>
      {showFooter && <Footer />}
      <CartSidebar />
    </div>
  );
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {

  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        <meta id="viewport" name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
        <link
          rel="stylesheet"
          as="style"
          crossOrigin="anonymous"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css"
        />
        <title>LlineStream</title>
      </head>
      <body className={cn('min-h-screen bg-background font-body antialiased')}>
        <FirebaseClientProvider>
          <LandingPageProvider>
            <CartProvider>
              <AppLayout>{children}</AppLayout>
              <Toaster />
            </CartProvider>
          </LandingPageProvider>
        </FirebaseClientProvider>
      </body>
    </html>
  );
}
