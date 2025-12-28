
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
  const [selectedInstructor, setSelectedInstructor] = useState<Instructor | null>(null);
  const [isPlayerDialogOpen, setPlayerDialogOpen] = useState(false);
  const [isPaymentDialogOpen, setPaymentDialogOpen] = useState(false);

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
  
  const hasSubscription = !!(user && course && user.activeSubscriptions?.[course.id]);

  const handlePlayClick = (episode: Episode) => {
    const isPlayable = episode.isFree || hasSubscription;
    setSelectedEpisode(episode);
    setSelectedInstructor(getInstructor(episode.instructorId) || null);

    if (isPlayable) {
      setPlayerDialogOpen(true);
    } else {
      setPaymentDialogOpen(true);
    }
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

  return (
    <div>
      <div className="container mx-auto max-w-5xl py-8">
        {isLoading || !course || !classification ? (
          <div className="space-y-4">
            <Skeleton className="h-10 w-3/4" />
            <Skeleton className="h-6 w-full" />
          </div>
        ) : (
          <>
            <h1 className="font-headline text-3xl font-bold">{`${classification.name} > ${course.name}`}</h1>
            <p className="text-muted-foreground mt-2">{course.description}</p>
          </>
        )}
        
        <h2 className="font-headline text-2xl font-bold mt-12 mb-4">
            에피소드 목록
        </h2>

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
              {episodes?.map((episode) => {
                const isPlayable = episode.isFree || hasSubscription;
                const instructor = getInstructor(episode.instructorId);
                const isSelected = selectedEpisode?.id === episode.id && isPlayerDialogOpen;

                return (
                  <li key={episode.id} className={cn("p-4 transition-colors", isSelected && "bg-muted")}>
                    <div
                      className="w-full flex items-start text-left group"
                    >
                      <div className="relative aspect-video w-24 md:w-28 rounded-md overflow-hidden bg-muted border flex-shrink-0">
                        {episode.thumbnailUrl ? (
                           <Image src={episode.thumbnailUrl} alt={episode.title} fill sizes="(max-width: 768px) 33vw, 20vw" className="object-cover" />
                        ) : (
                            <div className="flex items-center justify-center h-full">
                                <ImageIcon className="w-8 h-8 text-muted-foreground" />
                            </div>
                        )}
                      </div>
                      <div className="flex-grow px-4">
                         <div className="flex items-center gap-2">
                           {isSelected && <CheckCircle2 className="w-5 h-5 text-primary" />}
                         </div>
                        <p className="font-medium leading-tight mt-1">{episode.title}</p>
                         <div className="flex items-center gap-2 mt-2 text-sm text-muted-foreground">
                            {instructor && (
                                <>
                                    <Avatar className="h-5 w-5">
                                        <AvatarFallback>{instructor.name.charAt(0)}</AvatarFallback>
                                    </Avatar>
                                    <span>강사: {instructor.name}</span>
                                    <span className="mx-1">·</span>
                                </>
                            )}
                            <span>{formatDuration(episode.duration)}</span>
                         </div>
                      </div>
                      <div className="flex flex-row items-center justify-center gap-2 ml-auto pl-2">
                         <Button variant="outline" size="sm">
                            <MessageSquare className="w-4 h-4 mr-2"/>
                            채팅
                         </Button>
                        <Badge variant={isPlayable || episode.isFree ? "default" : "destructive"} className="whitespace-nowrap">
                            {episode.isFree ? '무료' : hasSubscription ? '시청 가능' : '구독 필요'}
                        </Badge>
                         <Button variant="ghost" size="icon" className="h-12 w-12 text-primary" onClick={() => handlePlayClick(episode)}>
                            <Play className="w-8 h-8" />
                         </Button>
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
            instructor={selectedInstructor}
        />
      )}

      {selectedEpisode && !selectedEpisode.isFree && course && (
         <PaymentDialog
            open={isPaymentDialogOpen}
            onOpenChange={setPaymentDialogOpen}
            item={course}
            itemType="course"
            selectedDuration="day30"
            selectedPrice={course.prices.day30}
            selectedLabel="30일 이용권"
        >
            {/* The trigger is now handled programmatically, so no child needed here */}
            <div></div> 
        </PaymentDialog>
      )}
    </div>
  );
}
