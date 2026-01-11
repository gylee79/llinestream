
'use client';

import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from '@/components/ui/carousel';
import CourseCard from './course-card';
import EpisodeCard from './episode-card';
import ClassificationCard from './classification-card';
import type { Course, Episode, Classification } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';

interface ContentCarouselProps {
  title?: string;
  items: (Course | Episode | Classification)[];
  itemType: 'course' | 'episode' | 'classification';
}

export default function ContentCarousel({ title, items, itemType }: ContentCarouselProps) {
  const isMobile = useIsMobile();
  
  if (!items || items.length === 0) {
    return null;
  }

  const isContinueWatching = title === '시청 기록';
  
  const getItemBasisClass = () => {
    // For "Continue Watching" on mobile, show 2.5 items.
    if (isContinueWatching && isMobile) {
      return 'basis-[40%]';
    }
    // For other carousels, use the default behavior.
    return 'basis-1/2 sm:basis-1/3 md:basis-1/4 lg:basis-1/5';
  };

  return (
    <section>
      <div className="flex justify-between items-center mb-4">
        {title && (
            <h2 className="font-headline text-2xl font-semibold tracking-tight">
              {title} <span className="text-muted-foreground text-xl">({items.length})</span>
            </h2>
        )}
      </div>
      <Carousel
        opts={{
          align: 'start',
          loop: false,
        }}
        className="w-full"
      >
        <CarouselContent className="-ml-2">
          {items.map((item) => (
            <CarouselItem key={item.id} className={cn(getItemBasisClass(), "pl-2")}>
              <div className="h-full">
                {itemType === 'course' && <CourseCard course={item as Course} />}
                {itemType === 'episode' && <EpisodeCard episode={item as Episode} />}
                {itemType === 'classification' && <ClassificationCard classification={item as Classification} />}
              </div>
            </CarouselItem>
          ))}
        </CarouselContent>
        <CarouselPrevious className="hidden sm:flex" />
        <CarouselNext className="hidden sm:flex" />
      </Carousel>
    </section>
  );
}
