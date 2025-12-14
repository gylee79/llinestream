import Image from 'next/image';
import { notFound } from 'next/navigation';
import { Lock, Play, Youtube } from 'lucide-react';
import { getCourseById, getEpisodesByCourse, getClassificationById } from '@/lib/data';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import PaymentDialog from '@/components/shared/payment-dialog';

export default function CourseDetailPage({ params }: { params: { courseId: string } }) {
  const course = getCourseById(params.courseId);
  if (!course) {
    notFound();
  }

  const episodes = getEpisodesByCourse(params.courseId);
  const classification = getClassificationById(course.classificationId);
  const firstEpisode = episodes[0];
  
  // Mock user subscription state
  const hasSubscription = false;

  const formatDuration = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  const PlayerOverlay = () => (
    <div className="relative aspect-video w-full">
      <Image
        src={course.thumbnailUrl}
        alt={course.name}
        data-ai-hint={course.thumbnailHint}
        fill
        className="object-cover"
      />
      <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center text-white p-4">
        {!hasSubscription && classification && classification.prices.day30 > 0 ? (
          <div className="text-center bg-black/70 p-8 rounded-lg">
            <Lock className="w-12 h-12 mx-auto mb-4"/>
            <h2 className="text-2xl font-bold">이용권이 필요한 콘텐츠입니다.</h2>
            <p className="mt-2 mb-6 text-white/80">이 콘텐츠를 시청하려면 이용권을 구매해주세요.</p>
            <PaymentDialog classification={classification}>
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

  return (
    <div>
      <div className="bg-black">
        <div className="container mx-auto max-w-5xl">
          {/* In a real app, this would be replaced by a video player */}
          <PlayerOverlay />
        </div>
      </div>
      <div className="container mx-auto max-w-5xl py-8">
        <h1 className="font-headline text-3xl font-bold">{course.name}</h1>
        <p className="text-muted-foreground mt-2">{course.description}</p>

        <h2 className="font-headline text-2xl font-bold mt-12 mb-4">에피소드 목록</h2>
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y">
              {episodes.map((episode, index) => {
                const isPlayable = episode.isFree || hasSubscription;
                return (
                  <li key={episode.id}>
                    <button
                      className={cn(
                        "w-full flex items-center p-4 text-left transition-colors",
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
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
