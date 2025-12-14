import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";

export default function AdminSubscriptionsPage() {
  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tight font-headline">구독/결제 관리</h1>
      <p className="text-muted-foreground">사용자 구독 및 결제 내역을 관리합니다.</p>
      <div className="mt-6">
        <Card>
          <CardHeader>
            <CardTitle>구현 예정</CardTitle>
            <CardDescription>
              이 페이지는 현재 개발 중입니다.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p>
              여기에서 모든 구독과 결제 거래를 추적하고 관리할 수 있습니다.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
