
'use client';

import Image from 'next/image';
import { motion } from 'framer-motion';

import { Skeleton } from '../ui/skeleton';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';

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
    <motion.div 
      className={cn(
          "relative h-[45vh] min-h-[350px] overflow-hidden md:h-[70vh] md:min-h-[500px]",
          "w-[90%] mx-auto md:w-full md:mx-0"
      )}
      initial={{ scale: 1.1 }}
      animate={{ scale: 1 }}
      transition={{ duration: 8, ease: "easeOut" }}
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
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/150 to-transparent" />
      <div className="absolute inset-0 z-10 flex h-full flex-col items-start justify-center p-6 px-8 md:p-12 text-left">
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
    </motion.div>
  );
}
