import Image from 'next/image';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import type { Course } from '@/lib/types';

interface CourseCardProps {
  course: Course;
}

export default function CourseCard({ course }: CourseCardProps) {
  return (
    <Link href={`/courses/${course.id}`} className="block h-full">
      <Card className="h-full overflow-hidden transition-all duration-300 hover:shadow-lg hover:border-primary/50">
        <div className="aspect-video overflow-hidden">
          <Image
            src={course.thumbnailUrl}
            alt={course.name}
            data-ai-hint={course.thumbnailHint}
            width={600}
            height={400}
            className="h-full w-full object-cover transition-transform duration-300 hover:scale-105"
          />
        </div>
        <CardHeader>
          <CardTitle className="font-headline text-lg tracking-tight truncate">{course.name}</CardTitle>
        </CardHeader>
        <CardContent>
          <CardDescription className="line-clamp-2 text-sm">{course.description}</CardDescription>
        </CardContent>
      </Card>
    </Link>
  );
}
