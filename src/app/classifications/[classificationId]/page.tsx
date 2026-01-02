
'use client';

import Image from 'next/image';
import { useParams, notFound } from 'next/navigation';
import { useDoc, useCollection, useFirestore, useMemoFirebase } from '@/firebase/hooks';
import { doc, collection, query, where } from 'firebase/firestore';
import type { Classification, Course, Field, Instructor } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import CourseCard from '@/components/shared/course-card';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

function ClassificationDetailClient({ classificationId }: { classificationId: string }) {
  const firestore = useFirestore();

  const classificationRef = useMemoFirebase(
    () => (firestore ? doc(firestore, 'classifications', classificationId) : null),
    [firestore, classificationId]
  );
  const { data: classification, isLoading: classificationLoading } = useDoc<Classification>(classificationRef);

  const coursesQuery = useMemoFirebase(
    () =>
      firestore && classification?.id
        ? query(collection(firestore, 'courses'), where('classificationId', '==', classification.id))
        : null,
    [firestore, classification?.id]
  );
  const { data: courses, isLoading: coursesLoading } = useCollection<Course>(coursesQuery);

  const fieldsQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'fields') : null), [firestore]);
  const { data: fields, isLoading: fieldsLoading } = useCollection<Field>(fieldsQuery);
  
  const instructorsQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'instructors') : null), [firestore]);
  const { data: instructors, isLoading: instructorsLoading } = useCollection<Instructor>(instructorsQuery);

  const isLoading = classificationLoading || coursesLoading || fieldsLoading || instructorsLoading;

  if (!isLoading && !classification) {
    notFound();
  }
  
  if (isLoading) {
      return (
          <div className="container mx-auto py-12">
              <Skeleton className="h-10 w-1/3 mb-4" />
              <Skeleton className="h-6 w-2/3 mb-8" />
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                  {Array.from({ length: 4 }).map((_, i) => (
                      <Skeleton key={i} className="h-72 w-full" />
                  ))}
              </div>
          </div>
      )
  }

  if (!classification) return null;

  const field = fields?.find(f => f.id === classification.fieldId);

  return (
    <div className="container mx-auto py-12">
      <header className="mb-12 text-center">
        <h1 className="font-headline text-4xl font-bold tracking-tight text-foreground">{classification.name}</h1>
        <p className="mt-4 text-lg text-muted-foreground max-w-3xl mx-auto">
          {classification.description}
        </p>
      </header>

      <h2 className="text-2xl font-bold font-headline mb-6 tracking-tight">관련 강좌 목록</h2>
      {courses && courses.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-6 gap-y-10">
          {courses.map((course, index) => {
             const instructor = instructors?.find(i => i.id === course.instructorId);
             return (
                <CourseCard 
                    key={course.id} 
                    course={course} 
                    instructor={instructor}
                    field={field}
                    rank={index + 1}
                />
            )
          })}
        </div>
      ) : (
        <div className="text-center py-16 border rounded-lg bg-muted/50">
            <p className="text-muted-foreground">아직 등록된 강좌가 없습니다.</p>
        </div>
      )}
    </div>
  );
}


export default function ClassificationDetailPage() {
  const params = useParams<{ classificationId: string }>();
  if (!params.classificationId) {
    return notFound();
  }
  return <ClassificationDetailClient classificationId={params.classificationId} />;
}
