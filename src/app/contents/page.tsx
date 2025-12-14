import ContentCarousel from '@/components/shared/content-carousel';
import { courses, classifications } from '@/lib/data';

export default function ContentsPage() {
  return (
    <div className="container mx-auto py-12">
      <header className="mb-12">
        <h1 className="font-headline text-4xl font-bold tracking-tight">전체 영상 콘텐츠</h1>
        <p className="mt-2 text-lg text-muted-foreground">LlineStream의 모든 콘텐츠를 한 눈에 살펴보세요.</p>
      </header>
      <div className="space-y-12">
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
