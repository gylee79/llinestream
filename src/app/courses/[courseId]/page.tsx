'use client';
import Image from 'next/image';
import { notFound, useParams } from 'next/navigation';
import { Lock, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import PaymentDialog from '@/components/shared/payment-dialog';
import { useDoc, useCollection, useFirestore, useUser, useMemoFirebase } from '@/firebase';
import { doc, collection, query, where } from 'firebase/firestore';
import type { Course, Episode, Classification } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';

export default function CourseDetailPage() {
  const params = useParams<{ courseId: string }>();
  const firestore = useFirestore();
  const { user } = useUser();

  const courseRef = useMemoFirebase(() => (firestore ? doc(firestore, 'courses', params.courseId) : null), [firestore, params.courseId]);
  const { data: course, isLoading: courseLoading } = useDoc<Course>(courseRef);

  const episodesQuery = useMemoFirebase(() => 
    firestore && course?.id ? query(collection(firestore, 'episodes'), where('courseId', '==', course.id)) : null, 
    [firestore, course?.id]
  );
  const { data: episodes, isLoading: episodesLoading } = useCollection<Episode>(episodesQuery);
  
  const classificationRef = useMemoFirebase(() => 
    firestore && course?.classificationId ? doc(firestore, 'classifications', course.classificationId) : null,
    [firestore, course?.classificationId]
  );
  const { data: classification, isLoading: classificationLoading } = useDoc<Classification>(classificationRef);

  const isLoading = courseLoading || episodesLoading || classificationLoading;

  if (!isLoading && !course) {
    notFound();
  }

  // Check user subscription
  const hasSubscription = !!(user && classification && user.activeSubscriptions?.[classification.id]);

  const firstEpisode = episodes?.[0];
  
  const formatDuration = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  const PlayerOverlay = () => {
    if (isLoading || !course) {
      return <Skeleton className="aspect-video w-full" />;
    }
    return (
      <div className="relative aspect-video w-full">
        <Image
          src={course.thumbnailUrl}
          alt={course.name}
          fill
          className="object-cover"
        />
        <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center text-white p-4">
          {!hasSubscription && classification && classification.prices.day30 > 0 ? (
            <div className="text-center bg-black/70 p-8 rounded-lg">
              <Lock className="w-12 h-12 mx-auto mb-4"/>
              <h2 className="text-2xl font-bold">이용권이 필요한 콘텐츠입니다.</h2>
              <p className="mt-2 mb-6 text-white/80">이 콘텐츠를 시청하려면 이용권을 구매해주세요.</p>
              <PaymentDialog 
                classification={classification}
                selectedDuration="day30"
                selectedPrice={classification.prices.day30}
                selectedLabel="30일 이용권"
              >
                <Button size="lg">이용권 구매하러 가기</Button>
              </PaymentDialog>
            </div>
          ) : (
            <>
              <h2 className="text-3xl font-bold font-headline">{course.name}</h2>
              <p className="mt-2 max-w-2xl text-center">{course.description}</p>
              <Button size="lg" className="mt-8">
                <Play className="mr-2 h-5 w-5 fill-current" />
                {firstEpisode ? '첫화 재생' : '재생'}
              </Button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="bg-black">
        <div className="container mx-auto max-w-5xl">
          <PlayerOverlay />
        </div>
      </div>
      <div className="container mx-auto max-w-5xl py-8">
        {isLoading || !course ? (
          <div className="space-y-4">
            <Skeleton className="h-10 w-3/4" />
            <Skeleton className="h-6 w-full" />
          </div>
        ) : (
          <>
            <h1 className="font-headline text-3xl font-bold">{course.name}</h1>
            <p className="text-muted-foreground mt-2">{course.description}</p>
          </>
        )}
        
        <h2 className="font-headline text-2xl font-bold mt-12 mb-4">에피소드 목록</h2>
        <Card>
          <CardContent className="p-0">
            {episodesLoading ? (
              <div className="p-4 space-y-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : (
            <ul className="divide-y">
              {episodes?.map((episode, index) => {
                const isPlayable = episode.isFree || hasSubscription;
                return (
                  <li key={episode.id}>
                    <button
                      className={cn(
                        "w-full flex items-center p-4 text-left transition-colors group",
                        isPlayable ? "hover:bg-muted/50 cursor-pointer" : "opacity-60 cursor-not-allowed"
                      )}
                      disabled={!isPlayable}
                      aria-label={isPlayable ? `Play ${episode.title}`: `Locked: ${episode.title}`}
                    >
                      <div className="flex items-center justify-center w-10 text-muted-foreground font-mono text-lg">
                        {index + 1}
                      </div>
                      <div className="flex-grow">
                        <p className="font-medium">{episode.title}</p>
                        <p className="text-sm text-muted-foreground mt-1">
                          {formatDuration(episode.duration)}
                        </p>
                      </div>
                      <div className="w-12 flex items-center justify-center">
                        {!isPlayable ? (
                          <Lock className="w-5 h-5 text-muted-foreground" />
                        ) : (
                          <Play className="w-6 h-6 text-primary opacity-0 group-hover:opacity-100 transition-opacity" />
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

    