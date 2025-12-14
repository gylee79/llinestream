import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";

export default function AdminDashboardPage() {
  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tight font-headline">관리자 대시보드</h1>
      <p className="text-muted-foreground">LlineStream의 현황을 한 눈에 파악하세요.</p>
      <div className="mt-6">
        <Card>
          <CardHeader>
            <CardTitle>환영합니다!</CardTitle>
            <CardDescription>
              좌측 메뉴를 통해 콘텐츠, 사용자, 설정 등을 관리할 수 있습니다.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p>
              이곳에서 LlineStream의 모든 것을 제어하고 모니터링하세요.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
