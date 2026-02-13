'use client';
import React from 'react';
import { usePathname } from 'next/navigation';
import { Toaster } from '@/components/ui/toaster';
import Header from '@/components/layout/header';
import BottomNavBar from '@/components/layout/bottom-nav-bar';
import { FirebaseClientProvider, useUser } from '@/firebase';
import { CartProvider } from '@/context/cart-context';
import CartSidebar from '@/components/cart/cart-sidebar';
import { cn } from '@/lib/utils';

function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user } = useUser();
  const isAdminPage = pathname?.startsWith('/admin');
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

export default function RootProvider({ children }: { children: React.ReactNode }) {
  return (
    <FirebaseClientProvider>
      <CartProvider>
        <AppLayout>{children}</AppLayout>
        <Toaster />
      </CartProvider>
    </FirebaseClientProvider>
  );
}
