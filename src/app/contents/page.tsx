'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useCollection, useFirestore, useMemoFirebase } from '@/firebase/hooks';
import { collection } from 'firebase/firestore';
import type { Course, Classification, Field, Instructor } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';

export default function ContentsPage() {
  const firestore = useFirestore();

  const fieldsQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'fields') : null), [firestore]);
  const { data: fields, isLoading: fieldsLoading } = useCollection<Field>(fieldsQuery);
  
  const classificationsQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'classifications') : null), [firestore]);
  const { data: classifications, isLoading: classificationsLoading } = useCollection<Classification>(classificationsQuery);

  const coursesQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'courses') : null), [firestore]);
  const { data: courses, isLoading: coursesLoading } = useCollection<Course>(coursesQuery);

  const instructorsQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'instructors') : null), [firestore]);
  const { data: instructors, isLoading: instructorsLoading } = useCollection<Instructor>(instructorsQuery);

  const isLoading = fieldsLoading || classificationsLoading || coursesLoading || instructorsLoading;

  const groupedCourses = useMemo(() => {
    if (isLoading || !courses || !classifications) return {};
    
    const classificationMap = new Map(classifications.map(c => [c.id, c.fieldId]));
    
    return courses.reduce((acc, course) => {
        const fieldId = classificationMap.get(course.classificationId);
        if (fieldId) {
            if (!acc[fieldId]) {
                acc[fieldId] = [];
            }
            acc[fieldId].push(course);
        }
        return acc;
    }, {} as Record<string, Course[]>);
  }, [courses, classifications, isLoading]);

  return (
    <div className="container mx-auto py-12">
      <header className="mb-12">
        <h1 className="font-headline text-4xl font-bold tracking-tight">전체 강좌</h1>
        <p className="mt-2 text-lg text-muted-foreground">분야별로 모든 강좌를 확인해보세요.</p>
      </header>
      
      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : (
        <Accordion type="multiple" className="w-full space-y-4">
            {fields?.map((field) => {
              const fieldCourses = groupedCourses[field.id] || [];
              if (fieldCourses.length === 0) return null;

              return (
                <AccordionItem value={field.id} key={field.id} className="border-b-0 rounded-lg bg-card shadow-sm overflow-hidden">
                  <AccordionTrigger className="px-6 py-4 text-xl font-bold hover:no-underline">
                    {field.name}
                  </AccordionTrigger>
                  <AccordionContent className="px-2 pt-0">
                    <div className="divide-y">
                      {fieldCourses.map(course => {
                        const classification = classifications?.find(c => c.id === course.classificationId);
                        const instructor = instructors?.find(i => i.id === course.instructorId);

                        return (
                          <Link href={`/courses/${course.id}`} key={course.id} className="block p-4 hover:bg-muted/50 transition-colors">
                            <div className="flex items-center gap-4">
                              <Avatar className="h-14 w-14 rounded-full">
                                {course.thumbnailUrl ? (
                                  <AvatarImage src={course.thumbnailUrl} alt={course.name} className="object-cover" />
                                ) : (
                                  <AvatarFallback className="text-xl font-bold">?</AvatarFallback>
                                )}
                              </Avatar>
                              <div className="flex-1">
                                {classification && <Badge variant="secondary" className="mb-1">{classification.name}</Badge>}
                                <h3 className="font-bold text-base leading-tight">{course.name}</h3>
                                <p className="text-sm text-muted-foreground mt-1">
                                  {instructor?.name || '강사 정보 없음'}
                                </p>
                              </div>
                            </div>
                          </Link>
                        )
                      })}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              )
            })}
        </Accordion>
      )}
    </div>
  );
}
