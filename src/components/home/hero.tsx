import Image from 'next/image';
import Link from 'next/link';
import { Play } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { Course } from '@/lib/types';
import { PlaceHolderImages } from '@/lib/placeholder-images';

interface HeroProps {
  course: Course;
}

export default function Hero({ course }: HeroProps) {
  const heroImage = PlaceHolderImages.find(img => img.id === 'hero-bg');

  return (
    <div className="relative h-[60vh] min-h-[400px] w-full">
      {heroImage && (
        <Image
          src={heroImage.imageUrl}
          alt={heroImage.description}
          data-ai-hint={heroImage.imageHint}
          fill
          className="object-cover"
          priority
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/50 to-transparent" />
      <div className="relative z-10 flex h-full items-end">
        <div className="container mx-auto px-6 py-12 text-white">
          <div className="max-w-2xl">
            <h1 className="font-headline text-4xl font-bold md:text-6xl">
              {course.name}
            </h1>
            <p className="mt-4 max-w-prose text-lg text-white/90">
              {course.description}
            </p>
            <div className="mt-8 flex space-x-4">
              <Button size="lg" asChild className="bg-accent text-accent-foreground hover:bg-accent/90">
                <Link href={`/courses/${course.id}`}>
                  <Play className="mr-2 h-5 w-5 fill-current" />
                  재생
                </Link>
              </Button>
              <Button size="lg" variant="secondary" asChild>
                <Link href={`/courses/${course.id}`}>더보기</Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
