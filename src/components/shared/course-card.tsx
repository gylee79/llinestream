import Image from 'next/image';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import type { Course, Field, Instructor } from '@/lib/types';
import { cn } from '@/lib/utils';
import { ImageIcon, Star } from 'lucide-react';

interface CourseCardProps {
  course: Course;
  instructor?: Instructor;
  field?: Field;
  rank?: number;
}

export default function CourseCard({ course, instructor, field, rank }: CourseCardProps) {
  const rating = course.rating || 4.8;
  const reviewCount = course.reviewCount || 72;

  return (
    <Link href={`/courses/${course.id}`} className="block h-full group">
      <Card className="h-full flex flex-col border-transparent shadow-none hover:bg-card transition-colors duration-300 bg-transparent rounded-xl">
        <CardContent className="p-0">
          <div className="aspect-video overflow-hidden relative rounded-lg shadow-md group-hover:shadow-xl transition-shadow duration-300">
            {course.thumbnailUrl ? (
              <Image
                src={course.thumbnailUrl}
                alt={course.name}
                width={600}
                height={400}
                className="h-full w-full object-cover transition-transform duration-500 ease-in-out group-hover:scale-105"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-muted">
                <ImageIcon className="h-10 w-10 text-muted-foreground" />
              </div>
            )}
             <div className="absolute inset-0 bg-black/20 group-hover:bg-black/10 transition-colors duration-300" />
          </div>
          
          <div className="pt-3">
             <h3 className="font-headline font-semibold text-base leading-snug tracking-tight line-clamp-2 text-foreground group-hover:text-primary transition-colors duration-300">{course.name}</h3>
             <p className="text-sm text-muted-foreground mt-1 truncate">{course.description}</p>
             <p className="text-xs text-muted-foreground mt-2">{instructor?.name || 'LlineStream'}</p>
             <div className="flex items-center text-xs mt-2 gap-2">
                <div className="flex items-center gap-1">
                    <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />
                    <span className="font-bold text-sm">{rating.toFixed(1)}</span>
                    <span className="text-muted-foreground">({reviewCount})</span>
                </div>
                {field && rank && (
                    <p className="text-muted-foreground font-semibold">
                        {field.name}・{rank}위
                    </p>
                )}
             </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
