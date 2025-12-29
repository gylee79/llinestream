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
import type { Course, Episode, Classification, Instructor, EpisodeComment } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import VideoPlayerDialog from '@/components/shared/video-player-dialog';
import EpisodeCommentDialog from '@/components/shared/episode-comment-dialog';
import EpisodeCommentSection from '@/components/shared/episode-comment-section';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  type CarouselApi,
} from "@/components/ui/carousel";

function EpisodeComments({ episodeId }: { episodeId: string }) {
  const firestore = useFirestore();
  const commentsQuery = useMemoFirebase(
    () => (firestore ? query(collection(firestore, 'episodes', episodeId, 'comments')) : null),
    [firestore, episodeId]
  );
  const { data: comments } = useCollection<EpisodeComment>(commentsQuery);
  return <>{comments?.length || 0}</>;
}


export default function CourseDetailPage() {
  const params = useParams<{ courseId: string }>();
  const firestore = useFirestore();
  const { user } = useUser();
  
  const [selectedEpisode, setSelectedEpisode] = useState<Episode | null>(null);
  const [selectedInstructor, setSelectedInstructor] = useState<Instructor | null>(null);
  const [isPlayerDialogOpen, setPlayerDialogOpen] = useState(false);
  const [isPaymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [isCommentDialogOpen, setCommentDialogOpen] = useState(false);
  const [carouselApi, setCarouselApi] = useState<CarouselApi>()

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
  
  const hasSubscription = !!(user && classification && user.activeSubscriptions?.[classification.id]);

  useEffect(() => {
    if (!episodes || episodes.length === 0) return;
    if (!selectedEpisode) {
      setSelectedEpisode(episodes[0]);
    }
    
    if (!carouselApi) return;

    const handleSelect = () => {
        const selectedIndex = carouselApi.selectedScrollSnap();
        if (episodes[selectedIndex]) {
            setSelectedEpisode(episodes[selectedIndex]);
        }
    }
    carouselApi.on("select", handleSelect)
    return () => {
      carouselApi.off("select", handleSelect)
    }

  }, [episodes, selectedEpisode, carouselApi]);


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

  const handleCommentClick = (episode: Episode) => {
    setSelectedEpisode(episode);
    setCommentDialogOpen(true);
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
            <Skeleton className="aspect-video w-full" />
          </div>
        ) : (
          <>
            <h1 className="font-headline text-3xl font-bold">{`${classification.name} > ${course.name}`}</h1>
            <p className="text-muted-foreground mt-2">{course.description}</p>
            {course.introImageUrls && course.introImageUrls.length > 0 && (
              <div className="mt-8 space-y-4">
                  {course.introImageUrls.map((url, index) => (
                      <div key={index} className="relative aspect-video w-full rounded-lg overflow-hidden border">
                          <Image src={url} alt={`${course.name} 소개 이미지 ${index + 1}`} fill sizes="(max-width: 1024px) 100vw, 1024px" className="object-cover" />
                      </div>
                  ))}
              </div>
            )}
          </>
        )}
        
        <h2 className="font-headline text-2xl font-bold mt-12 mb-4">
            에피소드 목록
        </h2>
        
        {episodesLoading ? (
            <Card>
                <CardContent className="p-4 space-y-2">
                    <Skeleton className="h-48 w-full" />
                </CardContent>
            </Card>
        ) : episodes && episodes.length > 0 ? (
          <Carousel setApi={setCarouselApi} className="w-full">
            <CarouselContent>
              {episodes.map((episode) => {
                  const isPlayable = episode.isFree || hasSubscription;
                  const instructor = getInstructor(episode.instructorId);

                  return (
                    <CarouselItem key={episode.id}>
                      <Card className="overflow-hidden">
                        <CardContent className="p-0 flex flex-col md:flex-row">
                          <div className="relative aspect-video w-full md:w-1/2 flex-shrink-0 bg-muted border-r">
                              {episode.thumbnailUrl ? (
                                <Image src={episode.thumbnailUrl} alt={episode.title} fill sizes="(max-width: 768px) 100vw, 50vw" className="object-cover" />
                              ) : (
                                  <div className="flex items-center justify-center h-full">
                                      <ImageIcon className="w-12 h-12 text-muted-foreground" />
                                  </div>
                              )}
                          </div>
                          <div className="flex-grow p-6 flex flex-col justify-between">
                              <div>
                                  <Badge variant={isPlayable || episode.isFree ? "default" : "destructive"} className="whitespace-nowrap mb-2">
                                      {episode.isFree ? '무료' : hasSubscription ? '시청 가능' : '구독 필요'}
                                  </Badge>
                                  <h3 className="text-xl font-bold font-headline">{episode.title}</h3>
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
                              <div className="flex items-center gap-2 mt-4">
                                  <Button className="flex-1" onClick={() => handlePlayClick(episode)}>
                                      <Play className="w-4 h-4 mr-2"/>
                                      시청하기
                                  </Button>
                                  <Button variant="outline" onClick={() => handleCommentClick(episode)}>
                                      <MessageSquare className="w-4 h-4 mr-2"/>
                                      리뷰/질문 (<EpisodeComments episodeId={episode.id} />)
                                  </Button>
                              </div>
                          </div>
                        </CardContent>
                      </Card>
                    </CarouselItem>
                  );
              })}
            </CarouselContent>
            <CarouselPrevious className="left-[-50px] h-10 w-10" />
            <CarouselNext className="right-[-50px] h-10 w-10" />
          </Carousel>
        ) : (
            <Card>
                <CardContent className="p-10 text-center text-muted-foreground">
                    등록된 에피소드가 없습니다.
                </CardContent>
            </Card>
        )}

        {selectedEpisode && user && (
            <div className="mt-12">
                 <h2 className="font-headline text-2xl font-bold mb-4">
                    리뷰 및 질문: {selectedEpisode.title}
                </h2>
                <EpisodeCommentSection episode={selectedEpisode} user={user} />
            </div>
        )}

      </div>
      
      {selectedEpisode && (
        <VideoPlayerDialog 
            isOpen={isPlayerDialogOpen}
            onOpenChange={setPlayerDialogOpen}
            episode={selectedEpisode}
            instructor={selectedInstructor}
        />
      )}

      {selectedEpisode && user && (
        <EpisodeCommentDialog
          isOpen={isCommentDialogOpen}
          onOpenChange={setCommentDialogOpen}
          episode={selectedEpisode}
          user={user}
        />
      )}

      {selectedEpisode && !selectedEpisode.isFree && classification && (
         <PaymentDialog
            open={isPaymentDialogOpen}
            onOpenChange={setPaymentDialogOpen}
            item={classification}
            itemType="classification"
            selectedDuration={"day30"}
            selectedPrice={classification.prices.day30}
            selectedLabel="30일 이용권"
        >
            {/* The trigger is now handled programmatically, so no child needed here */}
            <div></div> 
        </PaymentDialog>
      )}
    </div>
  );
}
