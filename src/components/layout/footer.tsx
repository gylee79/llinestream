import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { LlineStreamLogo, KakaoIcon } from '@/components/icons';

export default function Footer() {
  const appName = "LlineStream";
  const slogan = "Your daily stream of knowledge and fun.";
  const copyright = `© ${new Date().getFullYear()} ${appName}. All rights reserved.`;

  return (
    <footer className="bg-muted/40">
      <div className="container mx-auto px-6 py-12">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-4">
          <div>
            <LlineStreamLogo className="h-7 w-auto" />
            <p className="mt-4 text-sm text-muted-foreground">{slogan}</p>
            <p className="mt-4 text-xs text-muted-foreground">{copyright}</p>
          </div>

          <div>
            <h3 className="font-semibold text-foreground">사업자 정보</h3>
            <div className="mt-4 space-y-2 text-sm text-muted-foreground">
              <p>대표자명: 홍길동</p>
              <p>사업자등록번호: 123-45-67890</p>
              <p>주소: 서울특별시 강남구 테헤란로 123</p>
            </div>
          </div>

          <div>
            <h3 className="font-semibold text-foreground">고객센터</h3>
            <div className="mt-4 space-y-2 text-sm text-muted-foreground">
              <p>전화번호: 1588-0000</p>
              <p>상담시간: 평일 09:00 - 18:00</p>
              <Button variant="ghost" className="h-auto p-0 justify-start text-sm text-muted-foreground hover:text-foreground">
                <KakaoIcon className="mr-2" />
                카카오톡 상담
              </Button>
            </div>
          </div>

          <div>
            <h3 className="font-semibold text-foreground">정책</h3>
            <nav className="mt-4 flex flex-col space-y-2 text-sm">
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
    </footer>
  );
}
