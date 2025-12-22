
'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowRight, Award, BrainCircuit, HandHeart, Users } from 'lucide-react';
import Image from 'next/image';
import { useDoc, useFirestore } from '@/firebase';
import { doc } from 'firebase/firestore';
import type { HeroImageSettings } from '@/lib/types';
import { useMemo } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { motion } from 'framer-motion';
import { useIsMobile } from '@/hooks/use-mobile';

const curriculum = [
  {
    title: '국가자격증 반',
    description: '체계적인 이론과 실습으로 합격률 90% 이상을 달성하는 피부/바디 기초 완성 과정입니다.',
    icon: Award,
  },
  {
    title: '림프 마스터 반 (Signature)',
    description: "'림프온'의 독보적인 재활/순환 테크닉을 전수받아 고객 만족도를 극대화하세요.",
    icon: HandHeart,
  },
  {
    title: 'AI & 감정 아로마 반',
    description: 'AI 진단과 도테라 오일을 활용한 멘탈 케어 및 조향 클래스로 차별화된 서비스를 제공합니다.',
    icon: BrainCircuit,
  },
  {
    title: '직원 위탁 교육 시스템',
    description: '원장님을 대신하여 신입 직원을 3일 만에 실무형 인재로 육성하는 가장 효율적인 솔루션입니다.',
    icon: Users,
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
        name: "향담소",
        description: "향기MBTI,성향분석,커플상담",
        cta: "상담 신청",
        href: "#"
    }
]

export default function AboutPage() {
  const firestore = useFirestore();
  const heroImagesRef = useMemo(() => (firestore ? doc(firestore, 'settings', 'heroImages') : null), [firestore]);
  const { data: heroImagesData, isLoading: heroImagesLoading } = useDoc<HeroImageSettings>(heroImagesRef);
  const isMobile = useIsMobile();

  const heroTitle = heroImagesData?.about?.title || '뷰티 비즈니스, 기술만 배운다고 성공할까요?';
  const heroDescription = heroImagesData?.about?.description || '림프 전문 테크닉부터 AI 상담 솔루션까지, 엘라인이 뷰티 전문가의 기준을 바꿉니다.';

  const heroImageUrl = isMobile 
    ? (heroImagesData?.about?.urlMobile || heroImagesData?.about?.url) 
    : heroImagesData?.about?.url;
  const heroImageHint = isMobile
    ? (heroImagesData?.about?.hintMobile || heroImagesData?.about?.hint)
    : heroImagesData?.about?.hint;


  return (
    <div className="bg-background text-foreground">
      {/* Hero Section */}
      <section className="relative h-[70vh] min-h-[500px] w-full flex flex-col items-start justify-center text-left text-white">
        {heroImagesLoading ? (
            <Skeleton className="absolute inset-0" />
        ) : (
            <Image
                src={heroImageUrl || "https://picsum.photos/seed/smart-beauty/1600/900"}
                alt="스마트 뷰티 교육"
                fill
                className="object-cover brightness-50"
                data-ai-hint={heroImageHint || "bright modern beauty academy"}
            />
        )}
        <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
            className="relative z-10 p-6 md:p-12 max-w-4xl"
        >
          <h1 className="font-headline text-4xl md:text-5xl font-bold tracking-tight">
            {heroTitle.split('\n').map((line, index) => (
                <span key={index} className={index === 1 ? "text-accent" : ""}>{line}<br/></span>
            ))}
          </h1>
          <p className="mt-6 text-lg md:text-xl text-white/90 max-w-2xl">
            {heroDescription}
          </p>
        </motion.div>
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
          <h2 className="text-3xl font-bold tracking-tight text-center mb-12">엘라인 아카데미 핵심 교육 과정</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-10 max-w-4xl mx-auto">
            {curriculum.map((item, index) => {
              const IconComponent = item.icon;
              return (
                <div key={index} className="flex items-start gap-6">
                  <div className="flex-shrink-0 flex items-center justify-center h-20 w-20 rounded-full border-2 border-accent bg-accent/10 text-accent">
                    <IconComponent className="h-10 w-10" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold font-headline text-primary">{item.title}</h3>
                    <p className="mt-2 text-muted-foreground">{item.description}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Differentiation Section */}
        <section className="grid md:grid-cols-2 gap-8 items-center bg-muted rounded-lg p-8 md:p-12">
            <motion.div 
                className="relative aspect-video rounded-lg overflow-hidden"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.5 }}
                transition={{ duration: 0.8 }}
            >
                <Image src="https://picsum.photos/seed/ai-beauty/800/600" alt="AI 기반 교육" fill style={{objectFit: "cover"}} data-ai-hint="futuristic beauty technology"/>
            </motion.div>
            <div>
                <h2 className="text-3xl font-bold tracking-tight">엘라인은 교육 방식부터 다릅니다.</h2>
                <p className="mt-4 text-muted-foreground text-lg">
온라인 영상시청,커뮤니티방,실제 현업의 전문가와 연결을 통해 현장 교육의 기회를 만들어 드립니다.
                </p>
            </div>
        </section>

        {/* Ecosystem Hub Section */}
        <section className="text-center">
            <h2 className="text-3xl font-bold tracking-tight">엘라인아카데미 협력 패밀리</h2>
            <p className="mt-4 text-muted-foreground text-lg max-w-2xl mx-auto">
                교육에서 끝나지 않습니다. 창업, 제품, 고객 관리까지 이어지는 <br className="sm:hidden" /> 성공의 선순환을 경험하세요.
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
    </div>
  );
}
