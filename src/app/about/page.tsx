import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import Image from 'next/image';

export default function AboutPage() {
  return (
    <div className="container mx-auto max-w-5xl py-12">
      <header className="mb-12 text-center">
        <h1 className="font-headline text-4xl font-bold tracking-tight">엘라인아카데미 소개</h1>
        <p className="mt-2 text-lg text-muted-foreground">
          배움의 새로운 기준을 제시합니다.
        </p>
      </header>
      
      <Card className="overflow-hidden">
        <div className="relative h-64 w-full">
            <Image 
                src="https://picsum.photos/seed/academy/1200/400"
                alt="엘라인아카데미"
                fill
                className="object-cover"
                data-ai-hint="library books"
            />
        </div>
        <CardHeader>
          <CardTitle>우리의 비전</CardTitle>
          <CardDescription>
            Lline-Academy는 시간과 장소에 구애받지 않고 최고의 교육 콘텐츠를 제공하여, 모든 이의 성장을 돕는 것을 목표로 합니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <h3 className="font-semibold text-lg mb-2">전문가와 함께하는 고품질 강의</h3>
            <p className="text-muted-foreground">
              각 분야 최고의 전문가들이 제작한 깊이 있고 실용적인 강의 콘텐츠를 통해 전문성을 한 단계 끌어올리세요. LlineStream의 뛰어난 스트리밍 기술로 언제 어디서든 끊김 없는 학습을 경험할 수 있습니다.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-lg mb-2">개인 맞춤형 학습 경로</h3>
            <p className="text-muted-foreground">
              단순히 영상을 시청하는 것을 넘어, 체계적인 학습 경로와 실습 과제를 통해 배운 내용을 온전히 자신의 것으로 만들 수 있습니다. 당신의 목표 달성을 위해 엘라인아카데미가 함께합니다.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
