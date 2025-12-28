
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
import type { Course, Episode } from '@/lib/types';

interface ContentCarouselProps {
  title: string;
  items: (Course | Episode)[];
  itemType: 'course' | 'episode';
}

export default function ContentCarousel({ title, items, itemType }: ContentCarouselProps) {
  if (!items || items.length === 0) {
    return null;
  }
  
  return (
    <section>
      <h2 className="mb-4 font-headline text-2xl font-semibold tracking-tight">
        {title}
      </h2>
      <Carousel
        opts={{
          align: 'start',
          loop: false,
        }}
        className="w-full"
      >
        <CarouselContent>
          {items.map((item) => (
            <CarouselItem key={item.id} className="basis-1/2 sm:basis-1/3 md:basis-1/4 lg:basis-1/5 xl:basis-1/6">
              <div className="p-1 h-full">
                {itemType === 'course' ? (
                    <CourseCard course={item as Course} />
                ) : (
                    <EpisodeCard episode={item as Episode} />
                )}
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
