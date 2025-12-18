import Image from 'next/image';
import Link from 'next/link';
import { Play } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { Course } from '@/lib/types';
import { Skeleton } from '../ui/skeleton';

interface HeroProps {
  course: Course;
  imageUrl?: string;
  imageHint?: string;
}

export default function Hero({ course, imageUrl, imageHint }: HeroProps) {

  return (
    <div className="relative h-[60vh] min-h-[400px] w-full">
      {imageUrl ? (
        <Image
          src={imageUrl}
          alt={imageHint || course.name}
          data-ai-hint={imageHint}
          fill
          className="object-cover"
          priority
        />
      ) : (
        <Skeleton className="h-full w-full" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/50 to-transparent" />
      <div className="absolute inset-0 z-10 flex h-full items-end">
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
