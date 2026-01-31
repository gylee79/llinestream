
'use client';

import { useUser, useCollection, useFirestore, useMemoFirebase } from '@/firebase/hooks';
import { collection } from 'firebase/firestore';
import type { Course, Instructor, Field } from '@/lib/types';
import CourseCard from '@/components/shared/course-card';
import { Skeleton } from '@/components/ui/skeleton';
import { useMemo } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function MyCoursesPage() {
  const { user, isUserLoading } = useUser();
  const firestore = useFirestore();

  const coursesQuery = useMemoFirebase(() => firestore ? collection(firestore, 'courses') : null, [firestore]);
  const { data: allCourses, isLoading: coursesLoading } = useCollection<Course>(coursesQuery);

  const fieldsQuery = useMemoFirebase(() => firestore ? collection(firestore, 'fields') : null, [firestore]);
  const { data: fields, isLoading: fieldsLoading } = useCollection<Field>(fieldsQuery);

  const instructorsQuery = useMemoFirebase(() => firestore ? collection(firestore, 'instructors') : null, [firestore]);
  const { data: instructors, isLoading: instructorsLoading } = useCollection<Instructor>(instructorsQuery);

  const myCourses = useMemo(() => {
    if (!user || !allCourses) return [];
    const myCourseIds = Object.keys(user.activeSubscriptions || {});
    return allCourses.filter(course => myCourseIds.includes(course.id));
  }, [user, allCourses]);

  const isLoading = isUserLoading || coursesLoading || instructorsLoading || fieldsLoading;

  return (
    <div className="container py-12">
      <header className="mb-12">
        <h1 className="font-headline text-4xl font-bold tracking-tight">나의 강의실</h1>
        <p className="mt-2 text-lg text-muted-foreground">보유 중인 모든 수강권을 확인하고 학습을 시작하세요.</p>
      </header>
      
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-6 gap-y-10">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-72 w-full" />)}
        </div>
      ) : myCourses.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-6 gap-y-10">
          {myCourses.map((course) => {
            const instructor = instructors?.find(i => i.id === course.instructorId);
            return <CourseCard key={course.id} course={course} instructor={instructor} />;
          })}
        </div>
      ) : (
        <div className="text-center py-24 border rounded-lg bg-muted/50">
          <h2 className="text-2xl font-bold">보유한 수강권이 없습니다.</h2>
          <p className="mt-2 text-muted-foreground">관심있는 강좌의 수강권을 구매하고 학습을 시작해보세요!</p>
          <Button asChild className="mt-6">
            <Link href="/pricing">수강권 구매하러 가기</Link>
          </Button>
        </div>
      )}
    </div>
  );
}
