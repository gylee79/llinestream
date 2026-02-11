
'use client';
import React from 'react';
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
import { Skeleton } from '../ui/skeleton';
import { DebugLogProvider } from '@/context/debug-log-context';
import DebugOverlay from '@/components/shared/debug-overlay';


function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { preference, isLandingPageLoading } = useLandingPage();
  const { user } = useUser();

  const isAdminPage = pathname?.startsWith('/admin');

  if (isLandingPageLoading) {
    return (
      <div className="relative flex min-h-dvh flex-col bg-background">
        <Header />
        <main className="flex-1">
            <div className="container py-8 space-y-8">
                <Skeleton className="h-[70vh] w-full rounded-lg" />
            </div>
        </main>
        <CartSidebar />
      </div>
    );
  }

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

export default function RootProvider({ children }: { children: React.ReactNode }) {
  return (
    <FirebaseClientProvider>
      <LandingPageProvider>
        <DebugLogProvider>
          <CartProvider>
            <AppLayout>{children}</AppLayout>
            <Toaster />
            <DebugOverlay />
          </CartProvider>
        </DebugLogProvider>
      </LandingPageProvider>
    </FirebaseClientProvider>
  );
}
