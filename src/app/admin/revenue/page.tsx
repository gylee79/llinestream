import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";

export default function AdminRevenuePage() {
  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tight font-headline">매출 관리</h1>
      <p className="text-muted-foreground">기간별 매출 현황 및 통계를 확인합니다.</p>
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
              다양한 차트와 데이터를 통해 매출 성과를 분석할 수 있습니다.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
