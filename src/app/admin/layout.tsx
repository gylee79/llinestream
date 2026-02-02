
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart3,
  Cog,
  CreditCard,
  FolderKanban,
  LayoutDashboard,
  Menu,
  MessageSquare,
  Users,
  History,
  ShieldAlert,
  Bookmark,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { useUser } from '@/firebase/hooks';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';


const adminNavLinks = [
  { href: '/admin/dashboard', label: '대시보드', icon: LayoutDashboard },
  { href: '/admin/content', label: '콘텐츠 관리', icon: FolderKanban },
  { href: '/admin/users', label: '고객 관리', icon: Users },
  { href: '/admin/subscriptions', label: '구독/결제 관리', icon: CreditCard },
  { href: '/admin/revenue', label: '매출 관리', icon: BarChart3 },
  { href: '/admin/view-history', label: '시청 기록', icon: History },
  { href: '/admin/chats', label: 'AI 채팅 기록', icon: MessageSquare },
  { href: '/admin/bookmarks', label: '북마크 관리', icon: Bookmark },
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

const NotAuthorized = () => (
    <div className="flex h-screen w-full items-center justify-center p-6 bg-muted">
        <Card className="w-full max-w-md">
            <CardHeader className="text-center">
                <div className="mx-auto bg-destructive/10 p-3 rounded-full w-fit">
                    <ShieldAlert className="h-8 w-8 text-destructive"/>
                </div>
                <CardTitle className="mt-4">접근 권한 없음</CardTitle>
                <CardDescription>
                    이 페이지에 접근할 수 있는 권한이 없습니다. 관리자에게 문의하세요.
                </CardDescription>
            </CardHeader>
            <CardContent className="text-center">
                <Button asChild>
                    <Link href="/">홈으로 돌아가기</Link>
                </Button>
            </CardContent>
        </Card>
    </div>
);

const AdminLayoutShell = ({ children }: { children: React.ReactNode }) => (
  <div className="flex min-h-screen w-full">
    <aside className="hidden w-64 flex-col border-r bg-muted/40 md:flex">
      <div className="flex h-16 items-center border-b px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <span className="font-headline text-lg">관리자 패널</span>
        </Link>
      </div>
      <AdminNav />
    </aside>
    <div className="flex flex-1 flex-col">
      <header className="flex h-16 items-center gap-4 border-b bg-muted/40 px-6 md:hidden">
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline" size="icon" className="shrink-0">
              <Menu className="h-5 w-5" />
              <span className="sr-only">Toggle navigation menu</span>
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="flex flex-col p-0">
             <SheetHeader className="flex h-16 flex-row items-center justify-between border-b px-6">
              <Link href="/" className="flex items-center gap-2 font-semibold">
                 <span className="font-headline text-lg">관리자 패널</span>
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


export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, isUserLoading } = useUser();
  
  if (isUserLoading) {
    return (
        <div className="flex h-screen w-full items-center justify-center bg-muted">
            <div className="w-full max-w-sm space-y-4 rounded-lg bg-background p-8 shadow-lg">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-40 w-full" />
                <Skeleton className="h-10 w-1/2 mx-auto" />
            </div>
        </div>
    );
  }

  if (user?.role !== 'admin') {
    return <NotAuthorized />;
  }

  return <AdminLayoutShell>{children}</AdminLayoutShell>;
}
