
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

interface ContentCarouselProps {
  title?: string;
  items: (Course | Episode | Classification)[];
  itemType: 'course' | 'episode' | 'classification';
}

export default function ContentCarousel({ title, items, itemType }: ContentCarouselProps) {
  if (!items || items.length === 0) {
    return null;
  }

  const isContinueWatching = title === '나의 강의실';
  const isClassificationCarousel = itemType === 'classification';
  
  // Determine item basis based on the type of carousel
  const getItemBasisClass = () => {
    if (isContinueWatching) {
      // "나의 강의실": 2.5개 보이도록 설정
      return 'basis-[45%] sm:basis-1/3 md:basis-1/4 lg:basis-1/5 xl:basis-1/6';
    }
    if (isClassificationCarousel) {
      // "큰 분류": 2개 보이도록 설정
      return 'basis-1/2 sm:basis-1/3 md:basis-1/4 lg:basis-1/5 xl:basis-1/6';
    }
    // Default
    return 'basis-1/2 sm:basis-1/3 md:basis-1/4 lg:basis-1/5 xl:basis-1/6';
  };

  return (
    <section>
      {title && (
          <h2 className="mb-4 font-headline text-2xl font-semibold tracking-tight">
            {title}
          </h2>
      )}
      <Carousel
        opts={{
          align: 'start',
          loop: false,
        }}
        className="w-full"
      >
        <CarouselContent className={cn(isContinueWatching ? "-ml-4" : "-ml-2")}>
          {items.map((item) => (
            <CarouselItem key={item.id} className={cn(getItemBasisClass(), isContinueWatching ? "pl-4" : "pl-2")}>
              <div className="h-full">
                {itemType === 'course' && <CourseCard course={item as Course} />}
                {itemType === 'episode' && <EpisodeCard episode={item as Episode} />}
                {itemType === 'classification' && <ClassificationCard classification={item as Classification} />}
              </div>
            </CarouselItem>
          ))}
        </CarouselContent>
        
        {isClassificationCarousel && (
          <>
            <CarouselPrevious />
            <CarouselNext />
          </>
        )}
      </Carousel>
    </section>
  );
}
