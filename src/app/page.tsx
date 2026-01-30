
'use client';
import { useCollection, useFirestore, useUser, useMemoFirebase } from '@/firebase/hooks';
import { collection, query, orderBy } from 'firebase/firestore';
import { Course, Classification, Episode, Field, EpisodeViewLog, Instructor } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { useMemo } from 'react';
import Link from 'next/link';
import { Card, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Image from 'next/image';
import { Badge } from '@/components/ui/badge';
import { BookUser, ShoppingCart, Bell, Search, BookOpen } from 'lucide-react';
import ContentCarousel from '@/components/shared/content-carousel';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';


export default function Home() {
  const firestore = useFirestore();
  const { user } = useUser();

  const fieldsQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'fields') : null), [firestore]);
  const { data: fields, isLoading: fieldsLoading } = useCollection<Field>(fieldsQuery);

  const classificationsQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'classifications') : null), [firestore]);
  const { data: classifications, isLoading: classificationsLoading } = useCollection<Classification>(classificationsQuery);
  
  const coursesQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'courses') : null), [firestore]);
  const { data: allCourses, isLoading: coursesLoading } = useCollection<Course>(coursesQuery);
  
  const instructorsQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'instructors') : null), [firestore]);
  const { data: instructors, isLoading: instructorsLoading } = useCollection<Instructor>(instructorsQuery);

  const viewLogsQuery = useMemoFirebase(() => {
      if (!user || !firestore) return null;
      return query(
          collection(firestore, 'users', user.id, 'viewHistory'),
          orderBy('endedAt', 'desc')
      );
  }, [user, firestore]);
  const { data: viewLogs, isLoading: historyLoading } = useCollection<EpisodeViewLog>(viewLogsQuery);

  const episodesQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'episodes') : null), [firestore]);
  const { data: allEpisodes, isLoading: episodesLoading } = useCollection<Episode>(episodesQuery);

  const watchedEpisodes = useMemo(() => {
      if (!viewLogs || !allEpisodes) return [];
      const episodeMap = new Map(allEpisodes.map(e => [e.id, e]));
      const validLogs = viewLogs.filter(log => log.duration >= 5);
      const uniqueEpisodeIds = [...new Set(validLogs.map(log => log.episodeId))];
      return uniqueEpisodeIds.map(episodeId => episodeMap.get(episodeId)).filter(Boolean) as Episode[];
  }, [viewLogs, allEpisodes]);

  const recommendedClassifications = useMemo(() => {
    return classifications?.slice(0, 2) || [];
  }, [classifications]);

  const groupedCourses = useMemo(() => {
    if (!allCourses || !classifications) return {};
    
    const classificationMap = new Map(classifications.map(c => [c.id, c.fieldId]));
    
    return allCourses.reduce((acc, course) => {
        const fieldId = classificationMap.get(course.classificationId);
        if (fieldId) {
            if (!acc[fieldId]) {
                acc[fieldId] = [];
            }
            acc[fieldId].push(course);
        }
        return acc;
    }, {} as Record<string, Course[]>);
  }, [allCourses, classifications]);


  const isLoading = fieldsLoading || classificationsLoading || coursesLoading || instructorsLoading || (user && (historyLoading || episodesLoading));
  
  if (isLoading) {
      return (
          <div className="container mx-auto py-8 space-y-8">
            <Skeleton className="h-40 w-full rounded-lg" />
            <Skeleton className="h-8 w-1/3" />
            <div className="grid grid-cols-2 gap-4">
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
            </div>
            <Skeleton className="h-64 w-full" />
          </div>
      )
  }

  return (
    <div className="flex-1 bg-muted/30">
      <div className="container mx-auto space-y-6 md:space-y-8 py-6 md:py-8">
        
        {/* User Greeting and Quick Actions */}
        {user ? (
            <section className="rounded-xl bg-card shadow-sm p-4 md:p-6">
                <h1 className="text-xl md:text-2xl font-bold">안녕하세요, {user.name}님!</h1>
                <p className="text-muted-foreground mt-1">오늘도 파이팅!</p>
                <div className="mt-6 flex justify-around border-t pt-4">
                    <Link href="/pricing" className="flex flex-col items-center gap-2 text-sm font-medium text-muted-foreground hover:text-primary transition-colors">
                        <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                            <ShoppingCart className="h-6 w-6" />
                        </div>
                        <span>수강신청</span>
                    </Link>
                    <Link href="/my-courses" className="flex flex-col items-center gap-2 text-sm font-medium text-muted-foreground hover:text-primary transition-colors">
                        <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                            <BookUser className="h-6 w-6" />
                        </div>
                        <span>나의 강의실</span>
                    </Link>
                    <button className="flex flex-col items-center gap-2 text-sm font-medium text-muted-foreground hover:text-primary transition-colors">
                        <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                            <div className="relative">
                                <Bell className="h-6 w-6" />
                                <Badge variant="destructive" className="absolute -right-2 -top-2 h-4 w-4 justify-center rounded-full p-0 text-[10px]">0</Badge>
                            </div>
                        </div>
                        <span>알림</span>
                    </button>
                </div>
            </section>
        ) : (
            <section className="rounded-xl bg-card shadow-sm p-6 md:p-8 text-center">
                 <h1 className="text-xl md:text-2xl font-bold">LlineStream에 오신 것을 환영합니다!</h1>
                 <p className="text-muted-foreground mt-2">로그인하고 맞춤형 학습 경험을 시작해보세요.</p>
                 <Button asChild className="mt-6">
                     <Link href="/login">로그인 / 회원가입</Link>
                 </Button>
            </section>
        )}

        {/* Recommendations */}
        {recommendedClassifications.length > 0 && (
            <section>
                <h2 className="text-lg md:text-xl font-bold tracking-tight mb-3 md:mb-4">지금 이 시기 추천!</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {recommendedClassifications.map(classification => (
                         <Link href={`/classifications/${classification.id}`} key={classification.id} className="block group">
                            <Card className="flex items-center justify-between p-4 h-full hover:bg-secondary/70 transition-colors">
                                <div className="max-w-[70%]">
                                    <p className="text-sm text-primary font-semibold">{fields?.find(f => f.id === classification.fieldId)?.name}</p>
                                    <CardTitle className="text-base md:text-lg mt-1 truncate">{classification.name}</CardTitle>
                                </div>
                                <div className="relative h-16 w-16 md:h-20 md:w-20 flex-shrink-0 overflow-hidden rounded-md">
                                    <Image
                                        src={classification.thumbnailUrl}
                                        alt={classification.name}
                                        fill
                                        sizes="(max-width: 768px) 64px, 80px"
                                        className="object-cover"
                                    />
                                </div>
                            </Card>
                        </Link>
                    ))}
                </div>
            </section>
        )}
        
        {/* Finder Section */}
        <section className="grid grid-cols-2 gap-4">
            <Link href="/contents" className="block">
                <Card className="p-4 flex flex-col items-center justify-center text-center h-full hover:bg-secondary/70 transition-colors">
                    <div className="h-12 w-12 rounded-full bg-blue-100 flex items-center justify-center text-blue-600">
                        <Search className="h-6 w-6"/>
                    </div>
                    <p className="mt-2 font-semibold text-sm md:text-base">강좌 찾기</p>
                </Card>
            </Link>
             <Link href="#" className="block">
                <Card className="p-4 flex flex-col items-center justify-center text-center h-full hover:bg-secondary/70 transition-colors">
                     <div className="h-12 w-12 rounded-full bg-green-100 flex items-center justify-center text-green-600">
                        <BookOpen className="h-6 w-6"/>
                    </div>
                    <p className="mt-2 font-semibold text-sm md:text-base">교재 찾기</p>
                </Card>
            </Link>
        </section>

        {/* Continue Watching */}
        {user && watchedEpisodes.length > 0 && (
          <ContentCarousel
            title="최근 학습 기록"
            items={watchedEpisodes}
            itemType="episode"
          />
        )}

        {/* All Courses by Field - Accordion Style */}
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
      </div>
    </div>
  );
}
