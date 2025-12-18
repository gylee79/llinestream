
'use client';
import ContentCarousel from '@/components/shared/content-carousel';
import Hero from '@/components/home/hero';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useCollection, useDoc, useFirestore } from '@/firebase';
import { collection, query, limit, collectionGroup, doc } from 'firebase/firestore';
import { Course, Classification, Episode, HeroImageSettings } from '@/lib/types';
import { useMemo } from 'react';
import { Skeleton } from '@/components/ui/skeleton';

export default function Home() {
  const firestore = useFirestore();

  const coursesQuery = useMemo(() => (firestore ? collection(firestore, 'courses') : null), [firestore]);
  const { data: courses, isLoading: coursesLoading } = useCollection<Course>(coursesQuery);

  const classificationsQuery = useMemo(() => (firestore ? collection(firestore, 'classifications') : null), [firestore]);
  const { data: classifications, isLoading: classificationsLoading } = useCollection<Classification>(classificationsQuery);

  const episodesQuery = useMemo(() => (firestore ? collectionGroup(firestore, 'episodes') : null), [firestore]);
  const { data: episodes, isLoading: episodesLoading } = useCollection<Episode>(episodesQuery);

  const heroCourseQuery = useMemo(() => 
    firestore ? query(collection(firestore, 'courses'), limit(1)) : null, 
    [firestore]
  );
  const { data: heroCourseData } = useCollection<Course>(heroCourseQuery);
  const heroCourse = heroCourseData?.[0];

  const heroImagesRef = useMemo(() => (firestore ? doc(firestore, 'settings', 'heroImages') : null), [firestore]);
  const { data: heroImagesData, isLoading: heroImagesLoading } = useDoc<HeroImageSettings>(heroImagesRef);

  const isLoading = coursesLoading || classificationsLoading || episodesLoading || heroImagesLoading;
  
  if (isLoading) {
      return (
          <div>
            <Skeleton className="h-[60vh] w-full" />
            <div className="container mx-auto py-12 text-center">
                <p>Loading...</p>
            </div>
          </div>
      )
  }

  if (!courses || courses.length === 0) {
    return (
      <div className="container mx-auto py-12 text-center">
        <Card>
          <CardHeader>
            <CardTitle>콘텐츠가 없습니다</CardTitle>
          </CardHeader>
          <CardContent>
            <p>관리자 페이지에서 콘텐츠를 추가해주세요.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Assuming a logged-in user with some viewing history
  const watchedCourses: Course[] = courses ? [courses[2], courses[4]].filter(Boolean) : []; 

  const freeCourses = courses?.filter(course =>
    episodes?.some(ep => ep.courseId === course.id && ep.isFree)
  );

  return (
    <div className="flex-1">
      {heroCourse && (
        <Hero 
          course={heroCourse}
          imageUrl={heroImagesData?.home?.url}
          imageHint={heroImagesData?.home?.hint}
        />
      )}
      <div className="container mx-auto space-y-12 py-12">
        {watchedCourses.length > 0 && <ContentCarousel title="나의 시청 동영상" courses={watchedCourses} />}
        {freeCourses && freeCourses.length > 0 && <ContentCarousel title="무료 영상" courses={freeCourses} />}
        {classifications?.map((classification) => {
          const classificationCourses = courses?.filter(
            (course) => course.classificationId === classification.id
          );
          if (!classificationCourses || classificationCourses.length === 0) return null;
          return (
            <ContentCarousel
              key={classification.id}
              title={classification.name}
              courses={classificationCourses}
            />
          );
        })}
      </div>
    </div>
  );
}
