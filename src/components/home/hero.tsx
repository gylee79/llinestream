
'use client';

import Image from 'next/image';
import { motion } from 'framer-motion';

import { Skeleton } from '../ui/skeleton';
import { useIsMobile } from '@/hooks/use-mobile';

interface HeroProps {
  title?: string;
  description?: string;
  imageUrl?: string;
  imageHint?: string;
  imageUrlMobile?: string;
  imageHintMobile?: string;
}

export default function Hero({ title, description, imageUrl, imageHint, imageUrlMobile, imageHintMobile }: HeroProps) {
  const isMobile = useIsMobile();
  const finalImageUrl = isMobile ? (imageUrlMobile || imageUrl) : imageUrl;
  const finalImageHint = isMobile ? (imageHintMobile || imageHint) : imageHint;

  return (
    <div className="relative h-[70vh] min-h-[500px] w-full">
      {finalImageUrl ? (
        <Image
          src={finalImageUrl}
          alt={finalImageHint || title || 'Hero background'}
          data-ai-hint={finalImageHint}
          fill
          className="object-cover"
          priority
        />
      ) : (
        <Skeleton className="h-full w-full" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/150 to-transparent" />
      <div className="absolute inset-0 z-10 flex h-full flex-col items-start justify-center p-6 md:p-12 text-left">
        <div className="container mx-auto text-white">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
            className="max-w-4xl"
          >
            {title && (
              <h1 className="font-headline text-4xl font-bold md:text-6xl">
                {title}
              </h1>
            )}
            {description && (
              <p className="mt-4 max-w-prose text-lg text-white/90">
                {description}
              </p>
            )}
          </motion.div>
        </div>
      </div>
    </div>
  );
}
