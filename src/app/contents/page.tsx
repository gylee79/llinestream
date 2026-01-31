'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useCollection, useFirestore, useMemoFirebase } from '@/firebase/hooks';
import { collection } from 'firebase/firestore';
import type { Course, Classification, Field, Instructor } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';

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

  const structuredData = useMemo(() => {
    if (isLoading || !fields || !classifications || !courses || !instructors) return [];

    // Sort all data by orderIndex
    const sortedFields = [...fields].sort((a, b) => (a.orderIndex ?? 999) - (b.orderIndex ?? 999));
    const sortedClassifications = [...classifications].sort((a, b) => (a.orderIndex ?? 999) - (b.orderIndex ?? 999));
    const sortedCourses = [...courses].sort((a, b) => (a.orderIndex ?? 999) - (b.orderIndex ?? 999));

    const courseMapByClassification = new Map<string, Course[]>();
    sortedCourses.forEach(course => {
      const list = courseMapByClassification.get(course.classificationId) || [];
      list.push(course);
      courseMapByClassification.set(course.classificationId, list);
    });

    const classificationMapByField = new Map<string, Classification[]>();
    sortedClassifications.forEach(cls => {
      const list = classificationMapByField.get(cls.fieldId) || [];
      list.push(cls);
      classificationMapByField.set(cls.fieldId, list);
    });

    const instructorMap = new Map(instructors.map(i => [i.id, i]));

    return sortedFields.map(field => {
      const fieldClassifications = classificationMapByField.get(field.id) || [];
      return {
        field,
        classifications: fieldClassifications.map(cls => {
          const classificationCourses = courseMapByClassification.get(cls.id) || [];
          return {
            classification: cls,
            courses: classificationCourses.map(course => ({
              course,
              instructor: instructorMap.get(course.instructorId || '')
            }))
          };
        }).filter(c => c.courses.length > 0)
      };
    }).filter(f => f.classifications.length > 0);

  }, [fields, classifications, courses, instructors, isLoading]);

  return (
    <div className="container mx-auto py-12">
      <header className="mb-8">
        <h1 className="font-headline text-4xl font-bold tracking-tight">전체 강좌</h1>
        <p className="mt-2 text-lg text-muted-foreground">분야별로 모든 강좌를 확인해보세요.</p>
      </header>
      
      {isLoading ? (
        <div className="space-y-8">
          <div className="space-y-4">
            <Skeleton className="h-8 w-1/4" />
            <Skeleton className="h-px w-full" />
            <div className="flex space-x-2">
              <Skeleton className="h-10 w-24 rounded-full" />
              <Skeleton className="h-10 w-24 rounded-full" />
            </div>
            <Skeleton className="h-32 w-full" />
          </div>
          <div className="space-y-4">
            <Skeleton className="h-8 w-1/4" />
            <Skeleton className="h-px w-full" />
            <div className="flex space-x-2">
              <Skeleton className="h-10 w-24 rounded-full" />
            </div>
            <Skeleton className="h-32 w-full" />
          </div>
        </div>
      ) : (
        <div className="space-y-12">
          {structuredData.map(({ field, classifications }) => (
            <div key={field.id}>
              <h2 className="text-2xl font-bold text-foreground">{field.name}</h2>
              <Separator className="my-4" />
              
              {classifications.length > 0 ? (
                <Tabs defaultValue={classifications[0].classification.id} className="w-full">
                  <TabsList className="h-auto bg-transparent p-0 space-x-2">
                    {classifications.map(({ classification }) => (
                      <TabsTrigger 
                        key={classification.id} 
                        value={classification.id} 
                        className="rounded-full data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
                      >
                        {classification.name}
                      </TabsTrigger>
                    ))}
                  </TabsList>

                  {classifications.map(({ classification, courses }) => (
                    <TabsContent key={classification.id} value={classification.id} className="mt-6">
                      <div className="space-y-4">
                        {courses.length > 0 ? (
                          courses.map(({ course, instructor }) => (
                            <Link href={`/courses/${course.id}`} key={course.id} className="block group">
                              <Card className="hover:bg-muted/50 transition-colors">
                                <CardContent className="p-4 flex items-center gap-4">
                                  <Avatar className="h-16 w-16 rounded-full">
                                    {course.thumbnailUrl ? (
                                      <AvatarImage src={course.thumbnailUrl} alt={course.name} className="object-cover" />
                                    ) : (
                                      <AvatarFallback className="text-2xl font-bold bg-muted">?</AvatarFallback>
                                    )}
                                  </Avatar>
                                  <div className="flex-1">
                                    <h3 className="font-bold text-lg leading-tight group-hover:text-primary transition-colors">{course.name}</h3>
                                    <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{course.description}</p>
                                    <p className="text-sm font-semibold text-foreground mt-2">
                                      {instructor?.name || '강사 정보 없음'}
                                    </p>
                                  </div>
                                </CardContent>
                              </Card>
                            </Link>
                          ))
                        ) : (
                           <div className="text-center py-16 border rounded-lg bg-muted/50">
                              <p className="text-muted-foreground">이 분류에는 아직 등록된 강좌가 없습니다.</p>
                           </div>
                        )}
                      </div>
                    </TabsContent>
                  ))}
                </Tabs>
              ) : (
                <div className="text-center py-16 border rounded-lg bg-muted/50">
                  <p className="text-muted-foreground">이 분야에는 아직 표시할 강좌가 없습니다.</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
