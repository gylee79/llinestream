
'use client';
import Link from 'next/link';
import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { LlineStreamLogo, KakaoIcon } from '@/components/icons';
import { useDoc, useFirestore } from '@/firebase';
import { doc } from 'firebase/firestore';
import type { FooterSettings } from '@/lib/types';
import { Skeleton } from '../ui/skeleton';

export default function Footer() {
  const firestore = useFirestore();
  const footerRef = useMemo(() => (firestore ? doc(firestore, 'settings', 'footer') : null), [firestore]);
  const { data: settings, isLoading } = useDoc<FooterSettings>(footerRef);

  if (isLoading || !settings) {
    return (
        <footer className="bg-muted/40">
          <div className="container mx-auto px-6 py-12">
            <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-4">
              <div>
                <LlineStreamLogo className="h-7 w-auto" />
                <Skeleton className="h-4 w-48 mt-4" />
                <Skeleton className="h-3 w-56 mt-4" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">사업자 정보</h3>
                <div className="mt-4 space-y-2 text-sm">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-4 w-48" />
                </div>
              </div>
              <div>
                <h3 className="font-semibold text-foreground">고객센터</h3>
                <div className="mt-4 space-y-2 text-sm">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-40" />
                </div>
              </div>
              <div>
                <h3 className="font-semibold text-foreground">정책</h3>
                <nav className="mt-4 flex flex-col space-y-2 text-sm">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-20" />
                </nav>
              </div>
            </div>
          </div>
        </footer>
    );
  }

  return (
    <footer className="bg-muted/40">
      <div className="container mx-auto px-6 py-12">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-[1fr_2fr]">
          {/* Left Column: Logo and Slogan */}
          <div>
            <LlineStreamLogo appName={settings.appName} />
            <p className="mt-4 text-sm text-muted-foreground">{settings.slogan}</p>
            <p className="mt-4 text-xs text-muted-foreground">{settings.copyright}</p>
          </div>

          {/* Right Column: Info Grid */}
          <div className="grid grid-cols-3 gap-8">
            <div>
              <h3 className="font-semibold text-foreground">사업자 정보</h3>
              <div className="mt-4 space-y-2 text-[11px] text-muted-foreground">
                <p>
                  <span>{settings.companyName}</span>
                  <span className="mx-1">|</span>
                  <span>대표: {settings.representative}</span>
                </p>
                <p>사업자등록번호: {settings.businessNumber}</p>
                <p>주소: {settings.address}</p>
              </div>
            </div>

            <div>
              <h3 className="font-semibold text-foreground">고객센터</h3>
              <div className="mt-4 space-y-2 text-[11px] text-muted-foreground">
                <p>전화번호: {settings.supportPhone}</p>
                <p>상담시간: {settings.supportHours}</p>
                {settings.kakaoTalkUrl && (
                  <Button asChild variant="ghost" className="h-auto p-0 justify-start text-[11px] text-muted-foreground hover:text-foreground">
                    <Link href={settings.kakaoTalkUrl} target="_blank" rel="noopener noreferrer">
                      <KakaoIcon className="mr-1.5 h-3.5 w-3.5" />
                      카카오톡 상담
                    </Link>
                  </Button>
                )}
              </div>
            </div>

            <div>
              <h3 className="font-semibold text-foreground">정책</h3>
              <nav className="mt-4 flex flex-col space-y-2 text-[11px]">
                <Link href="/policies/terms" className="text-muted-foreground hover:text-foreground">
                  서비스 이용약관
                </Link>
                <Link href="/policies/privacy" className="text-muted-foreground hover:text-foreground">
                  개인정보처리방침
                </Link>
                <Link href="/policies/refund" className="text-muted-foreground hover:text-foreground">
                  환불 규정
                </Link>
              </nav>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
