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

  return (
    <div className="w-full">
      <motion.div 
        className={cn(
            "relative overflow-hidden",
            "h-[70vh] min-h-[500px] md:h-[80vh] md:min-h-[600px]",
            "md:rounded-b-[3rem]"
        )}
        initial={{ scale: 1.05, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 1.2, ease: "circOut" }}
      >
        {finalImageUrl ? (
          <Image
            src={finalImageUrl}
            alt={title || 'Hero background'}
            fill
            sizes="100vw"
            className="object-cover"
            priority
            quality={90}
          />
        ) : (
          <Skeleton className="h-full w-full" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/40 to-transparent" />
        <div className="absolute inset-0 z-10 flex h-full flex-col items-center justify-end p-6 text-center text-white">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.5, ease: 'easeOut' }}
            className="max-w-4xl pb-16 md:pb-24"
          >
            {title && (
              <h1 className="font-headline text-4xl font-bold md:text-6xl text-balance">
                {title}
              </h1>
            )}
            {description && (
              <p className="mt-4 max-w-prose text-base text-white/90 md:text-lg">
                {description}
              </p>
            )}
             <div className="mt-8 flex justify-center gap-4">
                <Button asChild size="lg" className="bg-white text-black hover:bg-white/90">
                    <Link href="/contents">콘텐츠 둘러보기</Link>
                </Button>
                <Button asChild size="lg" variant="outline" className="border-white text-white backdrop-blur-sm bg-white/10 hover:bg-white/20">
                    <Link href="/pricing">수강권 구매</Link>
                </Button>
             </div>
          </motion.div>
        </div>
      </motion.div>
    </div>
  );
}
