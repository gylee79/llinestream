
'use client';

import Image from 'next/image';
import { motion } from 'framer-motion';

import { Skeleton } from '../ui/skeleton';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import { Button } from '../ui/button';
import Link from 'next/link';

interface HeroProps {
  title?: string;
  description?: string;
  imageUrl?: string;
  imageUrlMobile?: string;
}

export default function Hero({ title, description, imageUrl, imageUrlMobile }: HeroProps) {
  const isMobile = useIsMobile();
  const finalImageUrl = isMobile ? (imageUrlMobile || imageUrl) : imageUrl;

  const heroDescription = "공부하며 궁금한 내용 AI가 도와드립니다~"

  return (
    <div className="w-full">
      <motion.div 
        className={cn(
            "relative overflow-hidden",
            "h-[70vh] min-h-[500px] md:h-[80vh] md:min-h-[600px]",
        )}
      >
        {finalImageUrl ? (
          <motion.div
            className="absolute inset-0"
            initial={{ scale: 1.1 }}
            animate={{ scale: 1 }}
            transition={{ duration: 8, ease: "easeInOut" }}
          >
            <Image
              src={finalImageUrl}
              alt={title || 'Hero background'}
              fill
              sizes="100vw"
              className="object-cover"
              priority
              quality={90}
            />
          </motion.div>
        ) : (
          <Skeleton className="h-full w-full" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/50 to-transparent" />
        <div className="absolute inset-0 z-10 flex h-full flex-col items-center justify-end p-6 text-center text-white">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.5, ease: 'easeOut' }}
            className="max-w-4xl pb-16 md:pb-24"
          >
            {title && (
              <h1 className="font-headline text-4xl font-bold md:text-6xl text-balance tracking-tight">
                {title}
              </h1>
            )}
            {heroDescription && (
              <p className="mt-4 max-w-prose text-base text-white/90 md:text-lg">
                {heroDescription}
              </p>
            )}
             <div className="mt-8 flex justify-center gap-4">
                <Button asChild size="lg" variant="outline" className="border-white text-white backdrop-blur-sm bg-white/10 hover:bg-white/20">
                    <Link href="/contents">콘텐츠 둘러보기</Link>
                </Button>
                <Button asChild size="lg" variant="outline" className="border-white text-white backdrop-blur-sm bg-white/10 hover:bg-white/20">
                    <Link href="/about">아카데미소개</Link>
                </Button>
             </div>
          </motion.div>
        </div>
      </motion.div>
    </div>
  );
}
