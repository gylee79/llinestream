import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from '@/components/ui/carousel';
import CourseCard from './course-card';
import type { Course } from '@/lib/types';

interface ContentCarouselProps {
  title: string;
  courses: Course[];
}

export default function ContentCarousel({ title, courses }: ContentCarouselProps) {
  if (courses.length === 0) {
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
          {courses.map((course) => (
            <CarouselItem key={course.id} className="md:basis-1/2 lg:basis-1/3 xl:basis-1/4">
              <div className="p-1 h-full">
                <CourseCard course={course} />
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
