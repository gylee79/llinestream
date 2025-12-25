
'use client';
import ContentCarousel from '@/components/shared/content-carousel';
import { useCollection, useFirestore, useMemoFirebase } from '@/firebase/hooks';
import { collection } from 'firebase/firestore';
import type { Course, Classification } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';

export default function ContentsPage() {
  const firestore = useFirestore();

  const coursesQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'courses') : null), [firestore]);
  const { data: courses, isLoading: coursesLoading } = useCollection<Course>(coursesQuery);

  const classificationsQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'classifications') : null), [firestore]);
  const { data: classifications, isLoading: classificationsLoading } = useCollection<Classification>(classificationsQuery);

  const isLoading = coursesLoading || classificationsLoading;

  return (
    <div className="container mx-auto py-12">
      <header className="mb-12">
        <h1 className="font-headline text-4xl font-bold tracking-tight">전체 영상 콘텐츠</h1>
        <p className="mt-2 text-lg text-muted-foreground">LlineStream의 모든 콘텐츠를 한 눈에 살펴보세요.</p>
      </header>
      <div className="space-y-12">
        {isLoading ? (
          <>
            <div className="space-y-4">
              <Skeleton className="h-8 w-1/4" />
              <div className="flex space-x-4">
                <Skeleton className="h-64 w-1/4" />
                <Skeleton className="h-64 w-1/4" />
                <Skeleton className="h-64 w-1/4" />
                <Skeleton className="h-64 w-1/4" />
              </div>
            </div>
            <div className="space-y-4">
              <Skeleton className="h-8 w-1/4" />
              <div className="flex space-x-4">
                <Skeleton className="h-64 w-1/4" />
                <Skeleton className="h-64 w-1/4" />
                <Skeleton className="h-64 w-1/4" />
                <Skeleton className="h-64 w-1/4" />
              </div>
            </div>
          </>
        ) : (
          classifications?.map((classification) => {
            const classificationCourses = courses?.filter(
              (course) => course.classificationId === classification.id
            );
            if (!classificationCourses || classificationCourses.length === 0) return null;
            return (
              <ContentCarousel
                key={classification.id}
                title={classification.name}
                courses={classificationCourses}
              />
            );
          })
        )}
      </div>
    </div>
  );
}
