'use client';

import { usePathname } from 'next/navigation';
import { Toaster } from '@/components/ui/toaster';
import Header from '@/components/layout/header';
import Footer from '@/components/layout/footer';
import BottomNavBar from '@/components/layout/bottom-nav-bar';
import { FirebaseClientProvider, useUser } from '@/firebase';
import { CartProvider } from '@/context/cart-context';
import CartSidebar from '@/components/cart/cart-sidebar';
import { LandingPageProvider, useLandingPage } from '@/context/landing-page-context';
import { cn } from '@/lib/utils';

// This component contains the client-side logic previously in RootLayout
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

// This is the main provider that wraps the entire app
export default function RootProvider({ children }: { children: React.ReactNode }) {
  return (
    <FirebaseClientProvider>
      <LandingPageProvider>
        <CartProvider>
          <AppLayout>{children}</AppLayout>
          <Toaster />
        </CartProvider>
      </LandingPageProvider>
    </FirebaseClientProvider>
  );
}
