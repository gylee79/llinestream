import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  FolderKanban,
  Users,
  CreditCard,
  BarChart3,
  History,
  MessageSquare,
  Bookmark,
  Cog,
} from 'lucide-react';

const adminLinks = [
  { href: '/admin/content', label: '콘텐츠 관리', icon: FolderKanban, description: '비디오, 분류, 가격 등 모든 콘텐츠를 관리합니다.' },
  { href: '/admin/users', label: '고객 관리', icon: Users, description: '사용자 정보, 구독 및 활동을 확인합니다.' },
  { href: '/admin/subscriptions', label: '구독/결제 관리', icon: CreditCard, description: '전체 구독 및 결제 내역을 조회합니다.' },
  { href: '/admin/revenue', label: '매출 관리', icon: BarChart3, description: '기간별 매출 현황 및 통계를 분석합니다.' },
  { href: '/admin/view-history', label: '시청 기록', icon: History, description: '사용자들의 비디오 시청 기록을 추적합니다.' },
  { href: '/admin/chats', label: 'AI 채팅 기록', icon: MessageSquare, description: 'AI 튜터와의 대화 내용을 검토합니다.' },
  { href: '/admin/bookmarks', label: '북마크 관리', icon: Bookmark, description: '사용자들이 저장한 북마크를 확인합니다.' },
  { href: '/admin/settings', label: '설정', icon: Cog, description: '앱의 전반적인 설정을 구성합니다.' },
];

export default function AdminDashboardPage() {
  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tight font-headline">관리자 대시보드</h1>
      <p className="text-muted-foreground">LlineStream의 현황을 한 눈에 파악하세요.</p>
      
      <div className="mt-8 grid gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {adminLinks.map((link) => (
          <Card key={link.href} className="flex flex-col">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <link.icon className="h-5 w-5" />
                <span>{link.label}</span>
              </CardTitle>
              <CardDescription className="h-10">{link.description}</CardDescription>
            </CardHeader>
            <CardContent className="flex-grow flex items-end">
              <Button asChild className="w-full">
                <Link href={link.href}>바로가기</Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
