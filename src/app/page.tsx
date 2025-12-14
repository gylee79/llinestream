'use client';
import ContentCarousel from '@/components/shared/content-carousel';
import Hero from '@/components/home/hero';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useCollection, useMemoFirebase } from '@/firebase';
import { useFirestore } from '@/firebase';
import { collection, query, where, limit } from 'firebase/firestore';
import { Course, Classification, Episode } from '@/lib/types';

export default function Home() {
  const firestore = useFirestore();

  // Fetch all data
  const coursesQuery = useMemoFirebase(() => collection(firestore, 'courses'), [firestore]);
  const { data: courses, isLoading: coursesLoading } = useCollection<Course>(coursesQuery);

  const classificationsQuery = useMemoFirebase(() => collection(firestore, 'classifications'), [firestore]);
  const { data: classifications, isLoading: classificationsLoading } = useCollection<Classification>(classificationsQuery);

  const episodesQuery = useMemoFirebase(() => collection(firestore, 'episodes'), [firestore]);
  const { data: episodes, isLoading: episodesLoading } = useCollection<Episode>(episodesQuery);

  const heroCourseQuery = useMemoFirebase(() => 
    query(collection(firestore, 'courses'), limit(1)), 
    [firestore]
  );
  const { data: heroCourseData } = useCollection<Course>(heroCourseQuery);
  const heroCourse = heroCourseData?.[0];

  const isLoading = coursesLoading || classificationsLoading || episodesLoading;
  
  if (isLoading) {
      return (
          <div className="container mx-auto py-12 text-center">
             <p>Loading...</p>
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
      {heroCourse && <Hero course={heroCourse} />}
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
