'use client';
import Image from 'next/image';
import { notFound, useParams } from 'next/navigation';
import { useDoc, useCollection, useFirestore, useUser, useMemoFirebase } from '@/firebase';
import { doc, collection, query, where, getDocs } from 'firebase/firestore';
import type { Course, Episode, Classification, Instructor, EpisodeComment, CarouselApi } from '@/lib/types';
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

export default function CourseDetailPage() {
  const params = useParams<{ courseId: string }>();
  const firestore = useFirestore();
  const { user } = useUser();

  const [comments, setComments] = useState<EpisodeComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(true);
  
  const [api, setApi] = useState<CarouselApi | undefined>();
  const { selectedIndex, scrollSnaps, onDotButtonClick } = useDotButton(api);


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

  useEffect(() => {
    const fetchComments = async () => {
      if (!firestore || !episodes || episodes.length === 0) {
        setCommentsLoading(false);
        return;
      };
      setCommentsLoading(true);
      try {
        const allComments: EpisodeComment[] = [];
        for (const episode of episodes) {
          const commentsQuery = query(collection(firestore, 'episodes', episode.id, 'comments'));
          const commentsSnapshot = await getDocs(commentsQuery);
          commentsSnapshot.forEach(doc => {
            allComments.push({ id: doc.id, ...doc.data() } as EpisodeComment);
          });
        }
        setComments(allComments);
      } catch (error) {
        console.error("Error fetching comments for course:", error);
      } finally {
        setCommentsLoading(false);
      }
    };
    fetchComments();
  }, [firestore, episodes]);

  const isLoading = courseLoading || episodesLoading || classificationLoading || instructorsLoading || commentsLoading;
  
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
    <div>
        <div className="w-full bg-muted">
            <div className="container mx-auto flex items-center gap-8 py-8">
                {/* Left side: Title and Description */}
                <div className="w-2/5">
                    <h1 className="font-headline text-3xl font-bold">{course.name}</h1>
                    <p className="text-muted-foreground mt-4">{course.description}</p>
                </div>
                {/* Right side: Image Carousel */}
                <div className="w-3/5">
                    <Carousel setApi={setApi} className="w-full">
                        <CarouselContent>
                            {introImages.map((url, index) => (
                                <CarouselItem key={index}>
                                    <div className="relative aspect-video">
                                        <Image src={url} alt={`${course.name} 소개 이미지 ${index + 1}`} fill sizes="60vw" className="object-contain rounded-lg" />
                                    </div>
                                </CarouselItem>
                            ))}
                        </CarouselContent>
                        <CarouselPrevious className="left-[-50px]" />
                        <CarouselNext className="right-[-50px]" />
                        <div className="absolute bottom-[-30px] w-full flex justify-center items-center gap-2">
                            {scrollSnaps.map((_, index) => (
                                <DotButton
                                    key={index}
                                    selected={index === selectedIndex}
                                    onClick={() => onDotButtonClick(index)}
                                />
                            ))}
                        </div>
                    </Carousel>
                </div>
            </div>
        </div>

      <div className="container mx-auto max-w-5xl py-8">
        
        {user && <CourseReviewSection comments={comments} user={user} />}
        
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
                    />
                  );
              })
            ) : (
                <p className="text-center text-muted-foreground py-10">등록된 에피소드가 없습니다.</p>
            )}
        </div>
      </div>
    </div>
  );
}
