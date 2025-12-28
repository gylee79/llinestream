'use client';
import Image from 'next/image';
import { notFound, useParams } from 'next/navigation';
import { Lock, Play, MessageSquare, ImageIcon, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import PaymentDialog from '@/components/shared/payment-dialog';
import { useDoc, useCollection, useFirestore, useUser, useMemoFirebase } from '@/firebase';
import { doc, collection, query, where } from 'firebase/firestore';
import type { Course, Episode, Classification, Instructor } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import VideoPlayerDialog from '@/components/shared/video-player-dialog';


export default function CourseDetailPage() {
  const params = useParams<{ courseId: string }>();
  const firestore = useFirestore();
  const { user } = useUser();
  
  const [selectedEpisode, setSelectedEpisode] = useState<Episode | null>(null);
  const [isPlayerDialogOpen, setPlayerDialogOpen] = useState(false);

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

  const instructorsQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'instructors') : null), [firestore]);
  const { data: instructors, isLoading: instructorsLoading } = useCollection<Instructor>(instructorsQuery);

  const isLoading = courseLoading || episodesLoading || classificationLoading || instructorsLoading;
  
  // Check user subscription
  const hasSubscription = !!(user && classification && user.activeSubscriptions?.[classification.id]);

  const handlePlayClick = (episode: Episode) => {
    setSelectedEpisode(episode);
    setPlayerDialogOpen(true);
  }

  if (!isLoading && !course) {
    notFound();
  }
  
  const formatDuration = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  const getInstructor = (instructorId?: string): Instructor | undefined => {
    if (!instructorId || !instructors) return undefined;
    return instructors.find(i => i.id === instructorId);
  }

  const CourseHero = () => {
    if (isLoading || !course) {
      return <Skeleton className="aspect-video w-full" />;
    }
    
    return (
      <div className="relative aspect-video w-full bg-black">
        {course.thumbnailUrl ? (
            <Image
                src={course.thumbnailUrl}
                alt={course.name}
                fill
                sizes="100vw"
                className="object-cover opacity-50"
            />
        ) : null}
        <div className="absolute inset-0 flex flex-col items-center justify-center text-white p-4">
          <div className="text-center">
            <h1 className="font-headline text-4xl font-bold">{course.name}</h1>
            {!hasSubscription && classification && classification.prices.day30 > 0 && (
              <div className="mt-6">
                <p className="mb-4 text-white/80">이 강좌의 모든 에피소드를 보려면 이용권이 필요합니다.</p>
                <PaymentDialog 
                    classification={classification}
                    selectedDuration="day30"
                    selectedPrice={classification.prices.day30}
                    selectedLabel="30일 이용권"
                >
                    <Button size="lg">이용권 구매하기</Button>
                </PaymentDialog>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="bg-black">
        <div className="container mx-auto max-w-5xl">
          <CourseHero />
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
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
              </div>
            ) : (
            <ul className="divide-y">
              {episodes?.map((episode, index) => {
                const isPlayable = episode.isFree || hasSubscription;
                const instructor = getInstructor(episode.instructorId);
                const isSelected = selectedEpisode?.id === episode.id && isPlayerDialogOpen;

                return (
                  <li key={episode.id} className={cn("p-4 transition-colors", isSelected && "bg-muted")}>
                    <div
                      className={cn(
                        "w-full flex items-start text-left group",
                        !isPlayable && "opacity-60"
                      )}
                    >
                      <div className="relative aspect-video w-32 md:w-40 rounded-md overflow-hidden bg-muted border flex-shrink-0">
                        {episode.thumbnailUrl ? (
                           <Image src={episode.thumbnailUrl} alt={episode.title} fill sizes="(max-width: 768px) 33vw, 20vw" className="object-cover" />
                        ) : (
                            <div className="flex items-center justify-center h-full">
                                <ImageIcon className="w-8 h-8 text-muted-foreground" />
                            </div>
                        )}
                         <Badge variant={episode.isFree ? "secondary" : "destructive"} className="absolute top-2 left-2">
                            {episode.isFree ? '무료' : '구독 필요'}
                         </Badge>
                      </div>
                      <div className="flex-grow px-4">
                        <div className="flex items-center gap-2">
                           {isSelected && <CheckCircle2 className="w-5 h-5 text-primary" />}
                           <p className="text-muted-foreground text-sm font-mono">{`EP ${index + 1}`}</p>
                        </div>
                        <p className="font-medium leading-tight mt-1">{episode.title}</p>
                         {instructor && (
                            <div className="flex items-center gap-2 mt-2 text-sm text-muted-foreground">
                                <Avatar className="h-5 w-5">
                                    <AvatarFallback>{instructor.name.charAt(0)}</AvatarFallback>
                                </Avatar>
                                <span>{instructor.name}</span>
                            </div>
                        )}
                        <p className="text-sm text-muted-foreground mt-2">
                          {formatDuration(episode.duration)}
                        </p>
                      </div>
                      <div className="flex flex-col items-center justify-center gap-2 ml-auto pl-2">
                        {!isPlayable ? (
                          <Lock className="w-5 h-5 text-muted-foreground" />
                        ) : (
                          <>
                             <Button variant="ghost" size="icon" className="h-8 w-8 text-primary" onClick={() => handlePlayClick(episode)}>
                                <Play className="w-6 h-6" />
                             </Button>
                             <Button variant="outline" size="sm" className="mt-2">
                                <MessageSquare className="w-4 h-4 mr-2"/>
                                채팅
                             </Button>
                          </>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
            )}
          </CardContent>
        </Card>
      </div>
      {selectedEpisode && (
        <VideoPlayerDialog 
            isOpen={isPlayerDialogOpen}
            onOpenChange={setPlayerDialogOpen}
            episode={selectedEpisode}
        />
      )}
    </div>
  );
}
