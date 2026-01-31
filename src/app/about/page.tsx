'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowRight } from 'lucide-react';
import Image from 'next/image';
import { useDoc, useFirestore, useMemoFirebase } from '@/firebase/hooks';
import { doc } from 'firebase/firestore';
import type { HeroImageSettings } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { motion } from 'framer-motion';
import { useIsMobile } from '@/hooks/use-mobile';
import Link from 'next/link';

const curriculum = [
  {
    title: '국가자격증 반',
    description: '피부/바디 기초 완성 과정',
    imageUrl: 'https://images.unsplash.com/photo-1556760544-442285d3b2a5?w=800&h=600&fit=crop&q=80',
    href: '/about/national-certificate',
    aiHint: 'certificate award'
  },
  {
    title: '림프 마스터 반 (Signature)',
    description: '독보적인 재활/순환 테크닉',
    imageUrl: 'https://images.unsplash.com/photo-1519824145371-296894a0d72b?w=800&h=600&fit=crop&q=80',
    href: '/about/lymph-master',
    aiHint: 'lymph massage'
  },
  {
    title: 'AI & 감정 아로마 반',
    description: 'AI 진단과 멘탈 케어 솔루션',
    imageUrl: 'https://images.unsplash.com/photo-1540555233-1282491befe4?w=800&h=600&fit=crop&q=80',
    href: '/about/ai-aroma',
    aiHint: 'AI aromatherapy'
  },
  {
    title: '직원 위탁 교육 시스템',
    description: '3일 완성 실무형 인재 육성',
    imageUrl: 'https://images.unsplash.com/photo-1552664730-d307ca884978?w=800&h=600&fit=crop&q=80',
    href: '/about/employee-training',
    aiHint: 'team training'
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
  const heroImagesRef = useMemoFirebase(() => (firestore ? doc(firestore, 'settings', 'heroImages') : null), [firestore]);
  const { data: heroImagesData, isLoading: heroImagesLoading } = useDoc<HeroImageSettings>(heroImagesRef);
  const isMobile = useIsMobile();

  const heroTitle = heroImagesData?.about?.title || '뷰티 비즈니스, 기술만 배운다고 성공할까요?';
  const heroDescription = heroImagesData?.about?.description || '림프 전문 테크닉부터 AI 상담 솔루션까지, 엘라인이 뷰티 전문가의 기준을 바꿉니다.';

  const heroImageUrl = isMobile 
    ? (heroImagesData?.about?.urlMobile || heroImagesData?.about?.url) 
    : heroImagesData?.about?.url;


  return (
    <div className="bg-background text-foreground">
      {/* Hero Section */}
      <section className="relative h-[70vh] min-h-[500px] w-full flex flex-col items-start justify-center text-left text-white">
        {heroImagesLoading ? (
            <Skeleton className="absolute inset-0" />
        ) : (
          <>
            <Image
                src={heroImageUrl || "https://picsum.photos/seed/smart-beauty/1600/900"}
                alt="스마트 뷰티 교육"
                fill
                sizes="100vw"
                className="object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/30 to-transparent" />
          </>
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

      <div className="container py-16 md:py-24 space-y-16 md:space-y-24">

        {/* Curriculum Section */}
        <section>
          <h2 className="text-3xl font-bold tracking-tight text-center mb-12">엘라인 아카데미 핵심 교육 과정</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {curriculum.map((item) => (
              <Link href={item.href} key={item.title} className="group block">
                <Card className="h-full overflow-hidden transition-all duration-300 ease-in-out hover:shadow-2xl hover:-translate-y-2">
                  <div className="relative aspect-[3/4] w-full">
                    <Image
                      src={item.imageUrl}
                      alt={item.title}
                      fill
                      sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                      className="object-cover transition-transform duration-500 group-hover:scale-105"
                      data-ai-hint={item.aiHint}
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />
                  </div>
                  <CardContent className="absolute bottom-0 left-0 right-0 p-4 bg-transparent text-white">
                    <h3 className="font-headline text-xl font-bold">{item.title}</h3>
                    <p className="text-sm text-white/80 mt-1">{item.description}</p>
                    <div className="flex items-center text-xs text-accent mt-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                        <span>자세히 보기</span>
                        <ArrowRight className="ml-1 h-3 w-3"/>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>

        {/* Differentiation Section */}
        <section className="grid md:grid-cols-2 gap-8 items-center bg-muted rounded-lg p-8 md:p-12">
            <div>
                <h2 className="text-3xl font-bold tracking-tight">엘라인은 교육 방식부터 다릅니다.</h2>
                <p className="mt-4 text-muted-foreground text-lg">
온라인 영상시청,커뮤니티방,실제 현업의 전문가와 연결을 통해 현장 교육의 기회를 만들어 드립니다.
                </p>
            </div>
            <motion.div 
                className="relative aspect-video rounded-lg overflow-hidden"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.5 }}
                transition={{ duration: 0.8 }}
            >
                <Image src="https://picsum.photos/seed/ai-beauty/800/600" alt="AI 기반 교육" fill sizes="(max-width: 768px) 100vw, 50vw" style={{objectFit: "cover"}} data-ai-hint="futuristic beauty technology"/>
            </motion.div>
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
