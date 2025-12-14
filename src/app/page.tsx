import ContentCarousel from '@/components/shared/content-carousel';
import Hero from '@/components/home/hero';
import { courses, classifications, episodes } from '@/lib/data';
import { Course } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function Home() {
  const heroCourse = courses.find(c => c.id === 'course-001');

  if (courses.length === 0) {
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
  const watchedCourses: Course[] = [courses[2], courses[4]]; 

  const freeCourses = courses.filter(course =>
    episodes.some(ep => ep.courseId === course.id && ep.isFree)
  );

  return (
    <div className="flex-1">
      {heroCourse && <Hero course={heroCourse} />}
      <div className="container mx-auto space-y-12 py-12">
        <ContentCarousel title="나의 시청 동영상" courses={watchedCourses} />
        <ContentCarousel title="무료 영상" courses={freeCourses} />
        {classifications.map((classification) => {
          const classificationCourses = courses.filter(
            (course) => course.classificationId === classification.id
          );
          if (classificationCourses.length === 0) return null;
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
