'use client';
import Image from 'next/image';
import { notFound, useParams } from 'next/navigation';
import { useDoc, useCollection, useFirestore, useUser, useMemoFirebase } from '@/firebase';
import { doc, collection, query, where, onSnapshot, Unsubscribe } from 'firebase/firestore';
import type { Course, Episode, Classification, Instructor, EpisodeComment, CarouselApi, EpisodeViewLog } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { useState, useEffect, useMemo } from 'react';
import EpisodeListItem from '@/components/shared/episode-list-item';
import CourseReviewSection from '@/components/shared/course-review-section';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from '@/components/ui/carousel';
import { DotButton, useDotButton } from '@/components/ui/dot-button';
import { Button } from '@/components/ui/button';
import EpisodeCommentDialog from '@/components/shared/episode-comment-dialog';
import CourseImagesDialog from '@/components/shared/course-images-dialog';

export default function CourseDetailPage() {
  const params = useParams<{ courseId: string }>();
  const firestore = useFirestore();
  const { user } = useUser();

  const [comments, setComments] = useState<EpisodeComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(true);
  
  const [api, setApi] = useState<CarouselApi | undefined>();
  const { selectedIndex, scrollSnaps, onDotButtonClick } = useDotButton(api);
  const [isAllReviewsOpen, setAllReviewsOpen] = useState(false);
  const [isImagesDialogOpen, setImagesDialogOpen] = useState(false);

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

  const viewHistoryQuery = useMemoFirebase(() => {
    if (!user || !firestore) return null;
    return collection(firestore, 'users', user.id, 'viewHistory');
  }, [user, firestore]);
  const { data: viewLogs, isLoading: viewLogsLoading } = useCollection<EpisodeViewLog>(viewHistoryQuery);

  const watchedEpisodeIds = useMemo(() => {
    if (!viewLogs) return new Set<string>();
    return new Set(viewLogs.map(log => log.episodeId));
  }, [viewLogs]);


  useEffect(() => {
    if (!firestore || !episodes || episodes.length === 0) {
      setComments([]);
      setCommentsLoading(false);
      return;
    }

    setCommentsLoading(true);
    const unsubscribers: Unsubscribe[] = [];
    const episodeCommentMap = new Map<string, EpisodeComment[]>();

    episodes.forEach(episode => {
      const commentsQuery = query(collection(firestore, 'episodes', episode.id, 'comments'));
      const unsubscribe = onSnapshot(commentsQuery, (querySnapshot) => {
        const episodeComments: EpisodeComment[] = [];
        querySnapshot.forEach(doc => {
          episodeComments.push({ id: doc.id, ...doc.data() } as EpisodeComment);
        });
        episodeCommentMap.set(episode.id, episodeComments);

        // Combine all comments from the map
        const allComments = Array.from(episodeCommentMap.values()).flat();
        
        // Sort all comments by creation date
        allComments.sort((a, b) => {
          const dateA = a.createdAt ? (a.createdAt as any).toDate() : new Date(0);
          const dateB = b.createdAt ? (b.createdAt as any).toDate() : new Date(0);
          return dateB.getTime() - dateA.getTime();
        });
        
        setComments(allComments);
        setCommentsLoading(false);
      }, (error) => {
        console.error(`Error fetching comments for episode ${episode.id}:`, error);
        setCommentsLoading(false);
      });
      unsubscribers.push(unsubscribe);
    });

    // Cleanup function to unsubscribe from all listeners when the component unmounts or dependencies change
    return () => {
      unsubscribers.forEach(unsub => unsub());
    };
  }, [firestore, episodes]);


  const isLoading = courseLoading || episodesLoading || classificationLoading || instructorsLoading || commentsLoading || (!!user && viewLogsLoading);
  
  const hasSubscription = !!(user && classification && classification.id && user.activeSubscriptions?.[classification.id]);

  if (isLoading) {
    return (
        <div className="container mx-auto max-w-5xl py-8 space-y-8">
            <Skeleton className="h-[40vh] w-full" />
            <Skeleton className="h-10 w-3/4" />
            <Skeleton className="h-6 w-full" />
            <div className="space-y-4">
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
            </div>
        </div>
    )
  }

  if (!course) {
    notFound();
  }
  
  const introImages = course.introImageUrls && course.introImageUrls.length > 0 ? course.introImageUrls : [course.thumbnailUrl];

  return (
    <>
      <div className="w-full bg-muted">
        <div className="container mx-auto max-w-5xl py-12">
          <div className="flex flex-col md:flex-row items-start gap-8 md:gap-12">
            <div className="w-full md:w-1/2">
              <h1 className="font-headline text-3xl font-bold">{course.name}</h1>
              <p className="text-muted-foreground mt-4">{course.description}</p>
            </div>
            <div className="w-full md:w-1/2">
              <Carousel setApi={setApi} className="w-full">
                <CarouselContent>
                  {introImages.map((url, index) => (
                    <CarouselItem key={index}>
                      <div className="relative aspect-video">
                        <Image src={url} alt={`${course.name} 소개 이미지 ${index + 1}`} fill sizes="(max-width: 768px) 100vw, 50vw" className="object-cover rounded-lg" />
                      </div>
                    </CarouselItem>
                  ))}
                </CarouselContent>
                <div className="relative mt-4 flex justify-center items-center gap-4">
                  <CarouselPrevious className="static translate-y-0" />
                  <div className="flex items-center gap-2">
                    {scrollSnaps.map((_, index) => (
                      <DotButton
                        key={index}
                        selected={index === selectedIndex}
                        onClick={() => onDotButtonClick(index)}
                      />
                    ))}
                  </div>
                  <CarouselNext className="static translate-y-0" />
                </div>
              </Carousel>
              <div className="mt-4 text-center">
                <Button variant="outline" onClick={() => setImagesDialogOpen(true)}>
                  상세페이지 전체보기
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto max-w-5xl pb-8">
        
        {user && <CourseReviewSection comments={comments} user={user} episodes={episodes || []} onToggleAllReviews={() => setAllReviewsOpen(true)} />}
        
        <h2 className="font-headline text-2xl font-bold mt-12 mb-4">
            에피소드 목록
        </h2>
        
        <div className="space-y-4">
            {episodes && episodes.length > 0 ? (
                episodes.map((episode) => {
                  const instructor = instructors?.find(i => i.id === episode.instructorId);
                  const episodeComments = comments.filter(c => c.episodeId === episode.id);
                  return (
                    <EpisodeListItem
                        key={episode.id}
                        episode={episode}
                        instructor={instructor}
                        isPlayable={episode.isFree || hasSubscription}
                        classification={classification}
                        user={user}
                        comments={episodeComments}
                        hasBeenWatched={watchedEpisodeIds.has(episode.id)}
                    />
                  );
              })
            ) : (
                <p className="text-center text-muted-foreground py-10">등록된 에피소드가 없습니다.</p>
            )}
        </div>
      </div>
      
      {user && (
        <EpisodeCommentDialog
            isOpen={isAllReviewsOpen}
            onOpenChange={setAllReviewsOpen}
            comments={comments}
            user={user}
            mode="view"
            episodes={episodes || []}
        />
      )}
      
      <CourseImagesDialog 
        isOpen={isImagesDialogOpen}
        onOpenChange={setImagesDialogOpen}
        images={introImages}
        courseName={course.name}
      />
    </>
  );
}
