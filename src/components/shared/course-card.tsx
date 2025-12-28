import Image from 'next/image';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import type { Course } from '@/lib/types';
import { cn } from '@/lib/utils';
import { ImageIcon } from 'lucide-react';

interface CourseCardProps {
  course: Course;
}

export default function CourseCard({ course }: CourseCardProps) {
  return (
    <Link href={`/courses/${course.id}`} className="block h-full">
      <Card className="h-full overflow-hidden transition-all duration-300 hover:shadow-lg hover:border-primary/50">
        <div className="aspect-video overflow-hidden relative">
          {course.thumbnailUrl ? (
            <Image
              src={course.thumbnailUrl}
              alt={course.name}
              width={600}
              height={400}
              className="h-full w-full object-cover transition-transform duration-300 hover:scale-105"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-muted">
              <ImageIcon className="h-10 w-10 text-muted-foreground" />
            </div>
          )}
        </div>
        <CardHeader>
          <CardTitle className="font-headline text-lg tracking-tight truncate">{course.name}</CardTitle>
        </CardHeader>
        <CardContent className="hidden md:block">
          <CardDescription className="line-clamp-2 text-sm">{course.description}</CardDescription>
        </CardContent>
      </Card>
    </Link>
  );
}
