
'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useCollection, useFirestore, useMemoFirebase } from '@/firebase/hooks';
import { collection } from 'firebase/firestore';
import type { Course, Classification, Field, Instructor } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from '@/components/ui/card';


export default function ContentsPage() {
  const firestore = useFirestore();
  const [activeTab, setActiveTab] = useState<string | undefined>(undefined);

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

  // Set default active tab once fields are loaded
  if (!activeTab && fields && fields.length > 0) {
    setActiveTab(fields[0].id);
  }

  return (
    <div className="container mx-auto py-12">
      <header className="mb-8">
        <h1 className="font-headline text-4xl font-bold tracking-tight">전체 강좌</h1>
        <p className="mt-2 text-lg text-muted-foreground">분야별로 모든 강좌를 확인해보세요.</p>
      </header>
      
      {isLoading ? (
        <div className="space-y-4">
          <div className="flex space-x-2">
            <Skeleton className="h-10 w-24" />
            <Skeleton className="h-10 w-24" />
            <Skeleton className="h-10 w-24" />
          </div>
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : (
        <Tabs defaultValue={fields?.[0]?.id} className="w-full">
          <TabsList className="mb-6">
            {fields?.map((field) => (
              <TabsTrigger key={field.id} value={field.id}>
                {field.name}
              </TabsTrigger>
            ))}
          </TabsList>
          
          {fields?.map((field) => {
            const fieldCourses = groupedCourses[field.id] || [];
            return (
              <TabsContent key={field.id} value={field.id}>
                {fieldCourses.length > 0 ? (
                  <div className="space-y-4">
                    {fieldCourses.map(course => {
                      const instructor = instructors?.find(i => i.id === course.instructorId);
                      return (
                        <Link href={`/courses/${course.id}`} key={course.id} className="block group">
                          <Card className="hover:bg-muted/50 transition-colors">
                            <CardContent className="p-4 flex items-start gap-4">
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
                      )
                    })}
                  </div>
                ) : (
                  <div className="text-center py-16 border rounded-lg bg-muted/50">
                    <p className="text-muted-foreground">이 분야에는 아직 등록된 강좌가 없습니다.</p>
                  </div>
                )}
              </TabsContent>
            )
          })}
        </Tabs>
      )}
    </div>
  );
}
