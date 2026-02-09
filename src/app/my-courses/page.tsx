'use client';

import { useState, useMemo } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useUser, useCollection, useFirestore, useMemoFirebase } from '@/firebase/hooks';
import { collection, query, where } from 'firebase/firestore';
import type { Course, Episode, Instructor, EpisodeViewLog } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Play, Clock, CheckCircle } from 'lucide-react';
import { formatDuration } from '@/lib/utils';
import VideoPlayerDialog from '@/components/shared/video-player-dialog';

const MyCoursesPage = () => {
  const { user, isUserLoading } = useUser();
  const firestore = useFirestore();

  // Data fetching
  const coursesQuery = useMemoFirebase(() => firestore ? collection(firestore, 'courses') : null, [firestore]);
  const { data: allCourses, isLoading: coursesLoading } = useCollection<Course>(coursesQuery);

  const episodesQuery = useMemoFirebase(() => firestore ? collection(firestore, 'episodes') : null, [firestore]);
  const { data: allEpisodes, isLoading: episodesLoading } = useCollection<Episode>(episodesQuery);

  const instructorsQuery = useMemoFirebase(() => firestore ? collection(firestore, 'instructors') : null, [firestore]);
  const { data: instructors, isLoading: instructorsLoading } = useCollection<Instructor>(instructorsQuery);

  const viewHistoryQuery = useMemoFirebase(() => {
    if (!user || !firestore) return null;
    return query(collection(firestore, 'users', user.id, 'viewHistory'));
  }, [user, firestore]);
  const { data: viewLogs, isLoading: viewLogsLoading } = useCollection<EpisodeViewLog>(viewHistoryQuery);

  const [playingEpisode, setPlayingEpisode] = useState<Episode | null>(null);

  // Data processing
  const subscribedCourses = useMemo(() => {
    if (!user || !allCourses) return [];
    const myCourseIds = Object.keys(user.activeSubscriptions || {});
    return allCourses.filter(course => myCourseIds.includes(course.id)).sort((a,b) => (a.orderIndex ?? 999) - (b.orderIndex ?? 999));
  }, [user, allCourses]);

  const episodesByCourse = useMemo(() => {
    if (!allEpisodes) return new Map<string, Episode[]>();
    const grouped = new Map<string, Episode[]>();
    allEpisodes.forEach(episode => {
      const courseEpisodes = grouped.get(episode.courseId) || [];
      courseEpisodes.push(episode);
      grouped.set(episode.courseId, courseEpisodes);
    });
    // Sort episodes within each course
    grouped.forEach(episodes => {
        episodes.sort((a, b) => (a.orderIndex ?? 999) - (b.orderIndex ?? 999));
    });
    return grouped;
  }, [allEpisodes]);

  const watchedEpisodeIds = useMemo(() => {
    if (!viewLogs) return new Set<string>();
    return new Set(viewLogs.map(log => log.episodeId));
  }, [viewLogs]);

  const isLoading = isUserLoading || coursesLoading || episodesLoading || instructorsLoading || viewLogsLoading;

  if (isLoading) {
    return (
      <div className="container py-12">
        <header className="mb-12">
          <Skeleton className="h-10 w-1/3 mb-4" />
          <Skeleton className="h-6 w-2/3" />
        </header>
        <div className="space-y-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      </div>
    );
  }

  if (!user || subscribedCourses.length === 0) {
    return (
      <div className="container py-12">
         <header className="mb-12">
          <h1 className="font-headline text-4xl font-bold tracking-tight">나의 강의실</h1>
          <p className="mt-2 text-lg text-muted-foreground">보유 중인 모든 수강권을 확인하고 학습을 시작하세요.</p>
        </header>
        <div className="text-center py-24 border rounded-lg bg-muted/50">
          <h2 className="text-2xl font-bold">보유한 수강권이 없습니다.</h2>
          <p className="mt-2 text-muted-foreground">관심있는 강좌의 수강권을 구매하고 학습을 시작해보세요!</p>
          <Button asChild className="mt-6">
            <Link href="/pricing">수강권 구매하러 가기</Link>
          </Button>
        </div>
      </div>
    );
  }
  
  const getInstructorForEpisode = (episode: Episode) => instructors?.find(i => i.id === episode.instructorId);

  return (
    <>
      <div className="container py-12">
        <header className="mb-12">
          <h1 className="font-headline text-4xl font-bold tracking-tight">나의 강의실</h1>
          <p className="mt-2 text-lg text-muted-foreground">보유 중인 모든 강좌의 에피소드를 확인하고 학습을 시작하세요.</p>
        </header>
        <Accordion type="multiple" className="w-full space-y-4">
          {subscribedCourses.map(course => {
            const courseEpisodes = episodesByCourse.get(course.id) || [];
            return (
              <AccordionItem value={course.id} key={course.id} className="border-b-0">
                <Card className="overflow-hidden">
                  <AccordionTrigger className="w-full text-left p-4 hover:no-underline bg-muted/50">
                    <div className="flex items-center gap-4">
                        <div className="relative w-20 aspect-video flex-shrink-0">
                            <Image src={course.thumbnailUrl} alt={course.name} fill sizes="80px" className="object-cover rounded-md" />
                        </div>
                        <div className="flex-1">
                            <h2 className="font-bold text-lg">{course.name}</h2>
                            <p className="text-sm text-muted-foreground line-clamp-1">{course.description}</p>
                        </div>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="p-0">
                    <div className="divide-y">
                      {courseEpisodes.length > 0 ? courseEpisodes.map(episode => (
                        <div key={episode.id} className="p-3 hover:bg-muted/50 cursor-pointer" onClick={() => setPlayingEpisode(episode)}>
                           <div className="flex gap-4 items-center">
                              <div className="relative h-12 w-20 flex-shrink-0 bg-muted rounded-md overflow-hidden">
                                  <Image src={episode.thumbnailUrl} alt={episode.title} fill sizes="80px" className="object-cover" />
                                  <div className="absolute inset-0 bg-black/20 flex items-center justify-center">
                                      <Play className="h-6 w-6 text-white" />
                                  </div>
                              </div>
                              <div className="flex-1 min-w-0">
                                  <p className="font-semibold truncate">{episode.title}</p>
                                  <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                                      <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{formatDuration(episode.duration)}</span>
                                      {watchedEpisodeIds.has(episode.id) && (
                                          <Badge variant="secondary" className="flex items-center gap-1 h-5 px-1.5 py-0 text-xs">
                                              <CheckCircle className="h-3 w-3 text-green-500" />
                                              시청 완료
                                          </Badge>
                                      )}
                                      {!episode.isFree && <Badge variant="outline">유료</Badge>}
                                  </div>
                              </div>
                           </div>
                        </div>
                      )) : (
                        <p className="text-center text-sm text-muted-foreground p-8">이 강좌에 등록된 에피소드가 없습니다.</p>
                      )}
                    </div>
                  </AccordionContent>
                </Card>
              </AccordionItem>
            )
          })}
        </Accordion>
      </div>
      {playingEpisode && (
        <VideoPlayerDialog
            isOpen={!!playingEpisode}
            onOpenChange={(open) => { if(!open) setPlayingEpisode(null) }}
            episode={playingEpisode}
            instructor={getInstructorForEpisode(playingEpisode) || null}
        />
      )}
    </>
  );
};

export default MyCoursesPage;
