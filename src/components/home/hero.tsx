import Image from 'next/image';
import { motion } from 'framer-motion';

import { Skeleton } from '../ui/skeleton';

interface HeroProps {
  title?: string;
  description?: string;
  imageUrl?: string;
  imageHint?: string;
}

export default function Hero({ title, description, imageUrl, imageHint }: HeroProps) {
  return (
    <div className="relative h-[50vh] min-h-[350px] w-full">
      {imageUrl ? (
        <Image
          src={imageUrl}
          alt={imageHint || title || 'Hero background'}
          data-ai-hint={imageHint}
          fill
          className="object-cover"
          priority
        />
      ) : (
        <Skeleton className="h-full w-full" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/50 to-transparent" />
      <div className="absolute inset-0 z-10 flex h-full items-center justify-center text-center">
        <div className="container mx-auto px-6 py-12 text-white">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
            className="max-w-4xl mx-auto"
          >
            {title && (
              <h1 className="font-headline text-4xl font-bold md:text-6xl">
                {title}
              </h1>
            )}
            {description && (
              <p className="mt-4 max-w-prose mx-auto text-lg text-white/90">
                {description}
              </p>
            )}
          </motion.div>
        </div>
      </div>
    </div>
  );
}
