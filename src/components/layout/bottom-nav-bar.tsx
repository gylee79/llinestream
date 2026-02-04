'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, BookUser, Bookmark, Clapperboard, Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import { LlineStreamLogo } from '@/components/icons';
import { useUser } from '@/firebase';

const navItems = [
  { href: '/my-courses', icon: BookUser, label: '나의 강의실' },
  { href: '/my-bookmarks', icon: Bookmark, label: '책갈피' },
  { href: '/', icon: Home, label: '홈' },
  { href: '/contents', icon: Clapperboard, label: '최근 영상' },
  { href: '/downloads', icon: Download, label: '다운로드함' },
];

export default function BottomNavBar() {
  const pathname = usePathname();
  const { user } = useUser();

  if (!user) {
    return null; // Don't show the nav bar if the user is not logged in
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 h-16 border-t bg-background/95 backdrop-blur-sm md:hidden">
      <nav className="grid h-full grid-cols-5 items-center">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex flex-col items-center justify-center gap-1 text-muted-foreground',
                isActive && 'text-primary'
              )}
            >
              <item.icon className="h-5 w-5" />
              <span className="text-[10px]">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
