
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import {
  CreditCard,
  Home,
  LogOut,
  User as UserIcon,
  Clapperboard,
  Menu,
  Shield,
  X,
  ShoppingCart,
  Info,
} from 'lucide-react';

import { LlineStreamLogo } from '@/components/icons';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetClose,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { useUser, useAuth, useDoc, useFirestore, useMemoFirebase } from '@/firebase/hooks';
import { signOut } from 'firebase/auth';
import { useCart } from '@/context/cart-context';
import { Badge } from '../ui/badge';
import type { FooterSettings } from '@/lib/types';
import { doc } from 'firebase/firestore';
import ProfileDialog from '@/components/profile/profile-dialog';
import BillingDialog from '@/components/profile/billing-dialog';


const navLinks = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/about', label: '엘라인아카데미소개', icon: Info },
  { href: '/contents', label: '영상 콘텐츠', icon: Clapperboard },
  { href: '/pricing', label: '가격 안내', icon: CreditCard },
];

const adminLink = { href: '/admin', label: '관리자', icon: Shield };

export default function Header() {
  const pathname = usePathname();
  const firestore = useFirestore();
  const { user, authUser, isUserLoading } = useUser();
  const auth = useAuth();
  const { openCart, items } = useCart();
  const isLoggedIn = !!authUser;
  const isAdmin = user?.role === 'admin';

  const [isProfileOpen, setProfileOpen] = useState(false);
  const [isBillingOpen, setBillingOpen] = useState(false);

  const footerRef = useMemoFirebase(() => (firestore ? doc(firestore, 'settings', 'footer') : null), [firestore]);
  const { data: settings } = useDoc<FooterSettings>(footerRef);
  const appName = settings?.appName || 'LlineStream';

  const handleLogout = async () => {
    if (auth) {
      await signOut(auth);
    }
  };

  const NavLink = ({ href, label, icon: Icon, isMobile, ...props }: { href: string, label: string, icon: React.ElementType, isMobile?: boolean }) => (
    <Link
      href={href}
      className={cn(
        'transition-colors hover:text-foreground/80',
        pathname === href ? 'text-foreground' : 'text-foreground/60',
        isMobile && 'flex items-center gap-4 px-2.5 py-2'
      )}
      {...props}
    >
      {isMobile && <Icon className="h-5 w-5" />}
      {label}
    </Link>
  )

  return (
    <>
      <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-16 max-w-screen-2xl items-center">
          {/* Mobile Menu */}
          <div className="md:hidden">
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon">
                  <Menu className="h-6 w-6" />
                  <span className="sr-only">Toggle Navigation</span>
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-full max-w-xs sm:max-w-sm">
                  <SheetHeader className="border-b pb-4">
                      <Link href="/" className="self-start">
                          <LlineStreamLogo appName={appName} />
                      </Link>
                      <SheetTitle className="sr-only">메뉴</SheetTitle>
                      <SheetDescription className="sr-only">메인 네비게이션 메뉴</SheetDescription>
                  </SheetHeader>
                  <nav className="grid gap-4 py-6 text-lg font-medium">
                      {navLinks.map((link) => (
                      <SheetClose asChild key={link.href}>
                          <NavLink {...link} isMobile />
                      </SheetClose>
                      ))}
                      {isAdmin && (
                      <SheetClose asChild>
                          <NavLink {...adminLink} isMobile />
                      </SheetClose>
                      )}
                  </nav>
              </SheetContent>
            </Sheet>
          </div>
          
          {/* Desktop Logo and Navigation */}
          <div className="flex flex-1 items-center justify-start">
              <Link href="/" className="ml-4 md:ml-0 mr-6 flex items-center space-x-2">
              <LlineStreamLogo appName={appName} />
              </Link>
              <nav className="hidden md:flex items-center space-x-6 text-sm font-medium">
              {navLinks.map((link) => (
                  <NavLink key={link.href} {...link} />
              ))}
              {isAdmin && <NavLink {...adminLink} />}
              </nav>
          </div>


          <div className="flex items-center justify-end space-x-2">
            <Button variant="ghost" size="icon" className="relative" onClick={openCart}>
                  <ShoppingCart className="h-5 w-5" />
                  {items.length > 0 && (
                      <Badge variant="destructive" className="absolute -right-2 -top-2 h-5 w-5 justify-center rounded-full p-0">
                          {items.length}
                      </Badge>
                  )}
                  <span className="sr-only">장바구니 열기</span>
              </Button>

            {isUserLoading ? (
              <Avatar className="h-8 w-8">
                <AvatarFallback>?</AvatarFallback>
              </Avatar>
            ) : isLoggedIn && user && authUser ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="relative h-8 w-8 rounded-full">
                    <Avatar className="h-8 w-8">
                      <AvatarImage
                        src={authUser.photoURL || `https://avatar.vercel.sh/${user.id}.png`}
                        alt={user.name || user.email || ''}
                      />
                      <AvatarFallback>{user.email?.charAt(0).toUpperCase()}</AvatarFallback>
                    </Avatar>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56" align="end" forceMount>
                  <DropdownMenuLabel className="font-normal">
                    <div className="flex flex-col space-y-1">
                      <p className="text-sm font-medium leading-none">{user.name || 'Unnamed User'}</p>
                      <p className="text-xs leading-none text-muted-foreground">
                        {user.email}
                      </p>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuItem onSelect={() => setProfileOpen(true)}>
                      <UserIcon className="mr-2 h-4 w-4" />
                      <span>Profile</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setBillingOpen(true)}>
                      <CreditCard className="mr-2 h-4 w-4" />
                      <span>Billing</span>
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleLogout}>
                    <LogOut className="mr-2 h-4 w-4" />
                    <span>Log out</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Button asChild>
                <Link href="/login">Login</Link>
              </Button>
            )}
          </div>
        </div>
      </header>
      {user && <ProfileDialog open={isProfileOpen} onOpenChange={setProfileOpen} user={user} />}
      {user && <BillingDialog open={isBillingOpen} onOpenChange={setBillingOpen} user={user} />}
    </>
  );
}
