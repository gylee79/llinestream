
'use client';

import {
  Carousel,
  CarouselContent,
  CarouselItem,
} from '@/components/ui/carousel';
import CourseCard from './course-card';
import EpisodeCard from './episode-card';
import ClassificationCard from './classification-card';
import type { Course, Episode, Classification, CarouselApi } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import { DotButton, useDotButton } from '../ui/dot-button';

interface ContentCarouselProps {
  title?: string;
  items: (Course | Episode | Classification)[];
  itemType: 'course' | 'episode' | 'classification';
}

export default function ContentCarousel({ title, items, itemType }: ContentCarouselProps) {
  const [api, setApi] = useState<CarouselApi>();
  const { selectedIndex, scrollSnaps, onDotButtonClick } = useDotButton(api);

  if (!items || items.length === 0) {
    return null;
  }

  const isContinueWatching = title === '나의 강의실';
  const isClassificationCarousel = itemType === 'classification';
  
  const getItemBasisClass = () => {
    if (isContinueWatching) {
      return 'basis-[45%] sm:basis-1/3 md:basis-1/4 lg:basis-1/5 xl:basis-1/6';
    }
    if (isClassificationCarousel) {
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
        setApi={setApi}
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
        
        {!isContinueWatching && (
          <div className="relative mt-4 flex justify-center items-center gap-2">
              {scrollSnaps.map((_, index) => (
                  <DotButton
                  key={index}
                  selected={index === selectedIndex}
                  onClick={() => onDotButtonClick(index)}
                  />
              ))}
          </div>
        )}
      </Carousel>
    </section>
  );
}
