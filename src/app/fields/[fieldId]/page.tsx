'use client';

import { useParams, notFound } from 'next/navigation';
import Link from 'next/link';
import { useCollection, useDoc, useFirestore, useMemoFirebase } from '@/firebase/hooks';
import { collection, query, where, doc, orderBy } from 'firebase/firestore';
import type { Course, Classification, Field, Instructor } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from '@/components/ui/card';
import { useMemo } from 'react';
import { Star } from 'lucide-react';

export default function FieldDetailPage() {
    const params = useParams<{ fieldId: string }>();
    const fieldId = params.fieldId;
    const firestore = useFirestore();

    const fieldRef = useMemoFirebase(() => (firestore && fieldId ? doc(firestore, 'fields', fieldId) : null), [firestore, fieldId]);
    const { data: field, isLoading: fieldLoading } = useDoc<Field>(fieldRef);
    
    const classificationsQuery = useMemoFirebase(() => (firestore && fieldId ? query(collection(firestore, 'classifications'), where('fieldId', '==', fieldId), orderBy('orderIndex')) : null), [firestore, fieldId]);
    const { data: classifications, isLoading: classificationsLoading } = useCollection<Classification>(classificationsQuery);

    // Get all classification IDs to query courses in one go
    const classificationIds = useMemo(() => classifications?.map(c => c.id) || [], [classifications]);

    const coursesQuery = useMemoFirebase(() => {
        if (!firestore || classificationIds.length === 0) return null;
        return query(collection(firestore, 'courses'), where('classificationId', 'in', classificationIds));
    }, [firestore, classificationIds]);
    const { data: courses, isLoading: coursesLoading } = useCollection<Course>(coursesQuery);

    const instructorsQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'instructors') : null), [firestore]);
    const { data: instructors, isLoading: instructorsLoading } = useCollection<Instructor>(instructorsQuery);

    const isLoading = fieldLoading || classificationsLoading || coursesLoading || instructorsLoading;

    const structuredData = useMemo(() => {
        if (!classifications || !courses || !instructors) return [];
        
        const courseMapByClassification = new Map<string, Course[]>();
        courses.forEach(course => {
          const list = courseMapByClassification.get(course.classificationId) || [];
          list.push(course);
          courseMapByClassification.set(course.classificationId, list);
        });

        const instructorMap = new Map(instructors.map(i => [i.id, i]));
        
        return classifications.map(cls => {
            const classificationCourses = courseMapByClassification.get(cls.id) || [];
            // Sort courses by orderIndex as they are not ordered by a query
            classificationCourses.sort((a, b) => (a.orderIndex ?? 999) - (b.orderIndex ?? 999));
            return {
                classification: cls,
                courses: classificationCourses.map(course => ({
                    course,
                    instructor: instructorMap.get(course.instructorId || '')
                }))
            }
        }).filter(c => c.courses.length > 0);

    }, [classifications, courses, instructors]);

    if (!isLoading && !field) {
        notFound();
    }
    
    const renderSkeletons = () => (
        <div className="space-y-8">
            <Skeleton className="h-12 w-1/3 mb-4" />
            <Skeleton className="h-4 w-2/3 mb-8" />
            <div className="flex space-x-2">
                <Skeleton className="h-10 w-24 rounded-full" />
                <Skeleton className="h-10 w-24 rounded-full" />
            </div>
            <Skeleton className="h-32 w-full mt-6" />
        </div>
    );

    return (
        <div className="container mx-auto pt-0 pb-12">
            {isLoading ? renderSkeletons() : field && (
                 <header className="mb-8">
                    <h1 className="font-headline text-3xl font-bold tracking-tight">{field.name}</h1>
                    <p className="mt-2 text-sm text-muted-foreground">{field.description || `모든 강좌를 확인해보세요.`}</p>
                </header>
            )}

            {!isLoading && structuredData.length > 0 && (
                <Tabs defaultValue={structuredData[0]?.classification.id} className="w-full">
                  <TabsList className="h-auto bg-transparent p-0 space-x-2">
                    {structuredData.map(({ classification }) => (
                      <TabsTrigger key={classification.id} value={classification.id} className="rounded-full data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                        {classification.name}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                  
                  {structuredData.map(({ classification, courses: courseData }) => (
                    <TabsContent key={classification.id} value={classification.id} className="mt-6">
                        <div className="space-y-4">
                            {courseData.length > 0 ? (
                                courseData.map(({ course, instructor }, index) => (
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
                                            <div className="flex items-center text-xs mt-2 gap-2">
                                                <div className="flex items-center gap-1">
                                                    <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />
                                                    <span className="font-bold text-sm">{(course.rating || 0).toFixed(1)}</span>
                                                    <span className="text-muted-foreground">({course.reviewCount || 0})</span>
                                                </div>
                                                <p className="text-muted-foreground font-semibold">
                                                    {classification.name}・{index + 1}위
                                                </p>
                                            </div>
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
            )}
             {!isLoading && structuredData.length === 0 && (
                 <div className="text-center py-16 border rounded-lg bg-muted/50">
                    <p className="text-muted-foreground">이 분야에는 아직 표시할 강좌가 없습니다.</p>
                </div>
            )}
        </div>
    );
}