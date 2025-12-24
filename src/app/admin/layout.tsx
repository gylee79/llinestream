
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart3,
  Cog,
  CreditCard,
  Database,
  FolderKanban,
  LayoutDashboard,
  Menu,
  Users,
} from 'lucide-react';
import { LlineStreamLogo } from '@/components/icons';
import { cn } from '@/lib/utils';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { useDoc, useFirestore, useMemoFirebase } from '@/firebase';
import type { FooterSettings } from '@/lib/types';
import { doc } from 'firebase/firestore';


const adminNavLinks = [
  { href: '/admin/dashboard', label: '대시보드', icon: LayoutDashboard },
  { href: '/admin/users', label: '고객 관리', icon: Users },
  { href: '/admin/content', label: '콘텐츠 관리', icon: FolderKanban },
  { href: '/admin/subscriptions', label: '구독/결제 관리', icon: CreditCard },
  { href: '/admin/revenue', label: '매출 관리', icon: BarChart3 },
  { href: '/admin/data-upload', label: '데이터 업로드', icon: Database },
  { href: '/admin/settings', label: '설정', icon: Cog },
];

const AdminNav = ({ className }: { className?: string }) => {
  const pathname = usePathname();
  return (
    <nav className={cn('flex-1 overflow-auto py-4', className)}>
      <ul className="grid items-start px-4 text-sm font-medium">
        {adminNavLinks.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:text-primary',
                pathname.startsWith(link.href) && 'bg-muted text-primary'
              )}
            >
              <link.icon className="h-4 w-4" />
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const firestore = useFirestore();
  const footerRef = useMemoFirebase(() => (firestore ? doc(firestore, 'settings', 'footer') : null), [firestore]);
  const { data: settings } = useDoc<FooterSettings>(footerRef);
  const appName = settings?.appName || 'LlineStream';

  return (
    <div className="flex min-h-screen w-full">
      <aside className="hidden w-64 flex-col border-r bg-muted/40 md:flex">
        <div className="flex h-16 items-center border-b px-6">
          <Link href="/admin/dashboard" className="flex items-center gap-2 font-semibold">
            <LlineStreamLogo appName={appName} />
          </Link>
        </div>
        <AdminNav />
      </aside>
      <div className="flex flex-1 flex-col">
        <header className="flex h-16 items-center gap-4 border-b bg-muted/40 px-6">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline" size="icon" className="shrink-0 md:hidden">
                <Menu className="h-5 w-5" />
                <span className="sr-only">Toggle navigation menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="flex flex-col p-0">
              <SheetHeader className="flex h-16 flex-row items-center justify-between border-b px-6">
                <Link href="/admin/dashboard">
                  <LlineStreamLogo appName={appName} />
                </Link>
                <SheetTitle className="sr-only">Admin Menu</SheetTitle>
              </SheetHeader>
              <AdminNav />
            </SheetContent>
          </Sheet>
          <div className="flex-1 text-right">
             {/* Admin Header Content (e.g., user profile) can go here */}
          </div>
        </header>
        <main className="flex-1 bg-background p-6">{children}</main>
      </div>
    </div>
  );
}
