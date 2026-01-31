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
import { BookUser, ShoppingCart, Bell, Search, BookOpen, ImageIcon } from 'lucide-react';
import ContentCarousel from '@/components/shared/content-carousel';

export default function Home() {
  const firestore = useFirestore();
  const { user } = useUser();

  const fieldsQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'fields'), orderBy('name')) : null), [firestore]);
  const { data: fields, isLoading: fieldsLoading } = useCollection<Field>(fieldsQuery);
  
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


  const isLoading = fieldsLoading || (user && (historyLoading || episodesLoading));
  
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

        {/* Continue Watching */}
        {user && watchedEpisodes.length > 0 && (
          <ContentCarousel
            title="최근 학습 기록"
            items={watchedEpisodes}
            itemType="episode"
          />
        )}
        
        {/* All Fields Section (ICON-BASED) */}
        <section>
          <h2 className="font-headline text-2xl font-semibold tracking-tight mb-4">분야별 강좌</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {fields?.map((field) => (
              <Link href={`/fields/${field.id}`} key={field.id} className="block group">
                <Card className="flex flex-col items-center justify-center text-center p-4 h-full hover:bg-secondary/70 transition-colors">
                   <div className="relative h-16 w-16 md:h-20 md:w-20 flex-shrink-0 overflow-hidden rounded-md bg-muted border">
                      {field.thumbnailUrl ? (
                          <Image
                              src={field.thumbnailUrl}
                              alt={field.name}
                              fill
                              sizes="(max-width: 768px) 64px, 80px"
                              className="object-cover"
                          />
                      ) : (
                          <div className="flex items-center justify-center h-full w-full">
                              <ImageIcon className="h-8 w-8 text-muted-foreground" />
                          </div>
                      )}
                    </div>
                    <p className="mt-2 font-semibold text-sm md:text-base line-clamp-2">{field.name}</p>
                </Card>
              </Link>
            ))}
          </div>
        </section>

      </div>
    </div>
  );
}
