'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowRight, BrainCircuit, HeartHand, Award, Users } from 'lucide-react';
import Image from 'next/image';

const curriculum = [
  {
    icon: Award,
    title: '국가자격증 반',
    description: '체계적인 이론과 실습으로 합격률 90% 이상을 달성하는 피부/바디 기초 완성 과정입니다.',
  },
  {
    icon: HeartHand,
    title: '림프 마스터 반 (Signature)',
    description: "'림프온'의 독보적인 재활/순환 테크닉을 전수받아 고객 만족도를 극대화하세요.",
  },
  {
    icon: BrainCircuit,
    title: 'AI & 감정 아로마 반',
    description: 'AI 진단과 도테라 오일을 활용한 멘탈 케어 및 조향 클래스로 차별화된 서비스를 제공합니다.',
  },
  {
    icon: Users,
    title: '직원 위탁 교육 시스템',
    description: '원장님을 대신하여 신입 직원을 3일 만에 실무형 인재로 육성하는 가장 효율적인 솔루션입니다.',
  },
];

const ecosystem = [
    {
        name: "림프온 (Lymph-On)",
        description: "림프 순환 전문 케어 샵",
        cta: "예약하기",
        href: "#"
    },
    {
        name: "하라쇼핑 (Hara Shopping)",
        description: "전문가용 제품 & 홈케어 편집샵",
        cta: "구매하기",
        href: "#"
    },
    {
        name: "HOPE (호프)",
        description: "웨딩 토탈 멘탈 케어 & 부부 상담 플랫폼",
        cta: "상담 신청",
        href: "#"
    }
]

export default function AboutPage() {
  return (
    <div className="bg-background text-foreground">
      {/* Hero Section */}
      <section className="relative h-[70vh] min-h-[500px] w-full flex items-center justify-center text-center text-white">
        <Image
          src="https://picsum.photos/seed/smart-beauty/1600/900"
          alt="스마트 뷰티 교육"
          fill
          className="object-cover brightness-50"
          data-ai-hint="bright modern beauty academy"
        />
        <div className="relative z-10 p-4 max-w-4xl mx-auto">
          <h1 className="font-headline text-4xl md:text-5xl font-bold tracking-tight">
            뷰티 비즈니스, 기술만 배운다고 성공할까요?
            <br />
            <span className="text-accent">시스템과 데이터를 배우세요.</span>
          </h1>
          <p className="mt-6 text-lg md:text-xl text-white/90 max-w-2xl mx-auto">
            림프 전문 테크닉부터 AI 상담 솔루션까지, 엘라인이 뷰티 전문가의 기준을 바꿉니다.
          </p>
        </div>
      </section>

      <div className="container mx-auto py-16 md:py-24 space-y-16 md:space-y-24">
        {/* Problem & Solution Section */}
        <section className="text-center max-w-3xl mx-auto">
            <h2 className="text-3xl font-bold tracking-tight">혼자서는 어려운 샵 운영의 모든 것</h2>
            <p className="mt-4 text-muted-foreground text-lg">
                직원 교육, 검증 안된 테크닉, 낮은 객단가. 원장님의 고민, 엘라인은 알고 있습니다.
            </p>
            <Card className="mt-8 bg-muted border-none p-8">
                <p className="text-2xl font-bold text-primary">
                사람의 손길(Touch) + AI의 데이터(Data) = <br className="sm:hidden" /> <span className="text-accent">대체 불가능한 전문가 양성</span>
                </p>
            </Card>
        </section>

        {/* Curriculum Section */}
        <section>
          <h2 className="text-3xl font-bold tracking-tight text-center">엘라인 아카데미 핵심 교육 과정</h2>
          <div className="mt-12 grid gap-8 md:grid-cols-2 lg:grid-cols-4">
            {curriculum.map((item, index) => (
              <Card key={index} className="flex flex-col text-center items-center">
                <CardHeader>
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <item.icon className="h-8 w-8" />
                  </div>
                  <CardTitle className="mt-4 font-headline">{item.title}</CardTitle>
                </CardHeader>
                <CardContent className="flex-grow">
                  <p className="text-muted-foreground">{item.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Differentiation Section */}
        <section className="grid md:grid-cols-2 gap-8 items-center bg-muted rounded-lg p-8 md:p-12">
            <div className="relative aspect-video rounded-lg overflow-hidden">
                <Image src="https://picsum.photos/seed/ai-beauty/800/600" alt="AI 기반 교육" layout="fill" objectFit="cover" data-ai-hint="futuristic beauty technology"/>
            </div>
            <div>
                <h2 className="text-3xl font-bold tracking-tight">엘라인은 교육 방식부터 다릅니다.</h2>
                <p className="mt-4 text-muted-foreground text-lg">
                    AI 성향 분석을 통한 맞춤형 레시피 추천, 스마트 디스펜서를 활용한 정밀 조향 실습까지.
                    데이터에 기반한 스마트 뷰티 교육으로 당신의 경쟁력을 완성하세요.
                </p>
            </div>
        </section>

        {/* Ecosystem Hub Section */}
        <section className="text-center">
            <h2 className="text-3xl font-bold tracking-tight">엘라인 그룹의 비즈니스 생태계</h2>
            <p className="mt-4 text-muted-foreground text-lg max-w-2xl mx-auto">
                교육에서 끝나지 않습니다. 창업, 제품, 고객 관리까지 이어지는 성공의 선순환을 경험하세요.
            </p>
            <div className="mt-12 grid md:grid-cols-3 gap-8">
                {ecosystem.map((brand) => (
                    <Card key={brand.name} className="p-8">
                        <h3 className="text-2xl font-bold font-headline text-primary">{brand.name}</h3>
                        <p className="mt-2 text-muted-foreground h-12">{brand.description}</p>
                        <Button asChild className="mt-6">
                            <a href={brand.href}>{brand.cta} <ArrowRight className="ml-2 h-4 w-4"/></a>
                        </Button>
                    </Card>
                ))}
            </div>
        </section>
      </div>

       {/* Footer & CTA Section */}
       <section className="bg-primary text-primary-foreground">
        <div className="container mx-auto py-16 text-center">
            <h2 className="text-3xl font-bold">당신의 뷰티 비즈니스, 엘라인이 러닝메이트가 되겠습니다.</h2>
            <p className="mt-4 text-lg opacity-80">지금 바로 상담을 통해 성공의 첫 걸음을 내딛어 보세요.</p>
            <div className="mt-8 flex flex-col sm:flex-row gap-4 justify-center">
                <Button variant="secondary" size="lg">전화 상담: 010-1234-5678</Button>
                <Button variant="ghost" size="lg" className="bg-accent text-accent-foreground hover:bg-accent/90">카카오톡 상담</Button>
            </div>
        </div>
      </section>
    </div>
  );
}
