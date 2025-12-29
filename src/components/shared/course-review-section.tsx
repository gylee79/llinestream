'use client';
import { useState, useMemo } from 'react';
import type { EpisodeComment, User } from '@/lib/types';
import { Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toDisplayDate } from '@/lib/date-helpers';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from '@/components/ui/carousel';
import EpisodeCommentDialog from './episode-comment-dialog';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartStyle,
} from '@/components/ui/chart';
import { BarChart, Bar } from 'recharts';

const ReviewItem = ({ comment }: { comment: EpisodeComment }) => {
    const [isExpanded, setIsExpanded] = useState(false);

    const toggleExpanded = () => setIsExpanded(!isExpanded);
    
    return (
        <Card className="h-full">
          <CardContent className="p-4 flex flex-col h-full">
            <div className="flex items-center gap-2">
                <span className="font-semibold text-sm">{comment.userName}</span>
                <span className="text-xs text-muted-foreground">{toDisplayDate(comment.createdAt)}</span>
            </div>
            {comment.rating && comment.rating > 0 && (
                <div className="flex items-center mt-1">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <Star key={star} className={cn('w-3 h-3', star <= comment.rating! ? 'text-yellow-400 fill-yellow-400' : 'text-muted-foreground')} />
                  ))}
                </div>
            )}
            <p 
              className={cn(
                "text-sm mt-2 flex-grow",
                !isExpanded && "line-clamp-3",
                "cursor-pointer"
              )}
              onClick={toggleExpanded}
            >
                {comment.content}
            </p>
          </CardContent>
        </Card>
    )
}

interface CourseReviewSectionProps {
  comments: EpisodeComment[];
  user: User;
}

export default function CourseReviewSection({ comments, user }: CourseReviewSectionProps) {
  const [isCommentDialogOpen, setCommentDialogOpen] = useState(false);

  const { averageRating, totalReviews, ratingDistribution, ratingCounts } = useMemo(() => {
    const ratedComments = comments.filter(c => c.rating && c.rating > 0);
    const totalReviews = ratedComments.length;
    if (totalReviews === 0) {
      return { averageRating: 0, totalReviews: 0, ratingDistribution: [0, 0, 0, 0, 0], ratingCounts: [0,0,0,0,0] };
    }
    const totalRating = ratedComments.reduce((sum, c) => sum + c.rating!, 0);
    const averageRating = totalRating / totalReviews;
    
    const counts = [0,0,0,0,0];
    ratedComments.forEach(c => {
        if(c.rating) counts[5-c.rating] += 1;
    })
    const distribution = counts.map(d => (totalReviews > 0 ? (d / totalReviews) * 100 : 0));

    return { averageRating, totalReviews, ratingDistribution: distribution, ratingCounts: counts };
  }, [comments]);
  
  const chartData = ratingDistribution.map((percentage, index) => ({
    star: 5 - index,
    count: ratingCounts[index],
  }));

  const chartConfig = {
    count: {
      label: 'Count',
      color: 'hsl(var(--primary))',
    },
  };

  const hasReviews = comments.length > 0;

  return (
    <>
      <div className="mt-3">
        <div className="flex justify-between items-center mb-4">
          <h2 className="font-headline text-2xl font-bold">리뷰 ({totalReviews})</h2>
          {hasReviews && (
             <Button variant="outline" onClick={() => setCommentDialogOpen(true)}>모든 리뷰 보기</Button>
          )}
        </div>
        
        {hasReviews ? (
           <div className="grid grid-cols-1 md:grid-cols-5 gap-8 items-stretch">
             {/* Rating Summary */}
             <div className="md:col-span-1 h-full">
                <Card className="h-full">
                    <CardContent className="p-4 flex flex-col h-full items-center justify-center text-center">
                        <span className="text-3xl font-bold">{averageRating.toFixed(1)}</span>
                        <div className="flex items-center my-1">
                            {[1,2,3,4,5].map(star => (
                                <Star key={star} className={cn("w-4 h-4", star <= averageRating ? 'text-yellow-400 fill-yellow-400' : 'text-muted-foreground/30')} />
                            ))}
                        </div>
                        <span className="text-xs text-muted-foreground">{totalReviews}개 리뷰</span>
                    </CardContent>
                </Card>
             </div>

            {/* Reviews Carousel */}
            <div className="md:col-span-4">
                <Carousel opts={{ align: 'start', loop: false }} className="w-full">
                    <CarouselContent className="-ml-4">
                        {comments.map(comment => (
                            <CarouselItem key={comment.id} className="md:basis-1/2 lg:basis-1/4 pl-4 flex">
                                <div className="p-1 h-full w-full">
                                    <ReviewItem comment={comment} />
                                </div>
                            </CarouselItem>
                        ))}
                    </CarouselContent>
                    <CarouselPrevious className="hidden sm:flex" />
                    <CarouselNext className="hidden sm:flex" />
                </Carousel>
            </div>
          </div>
        ) : (
             <div className="text-center py-16 border rounded-lg bg-muted/50">
                <p className="text-muted-foreground">아직 작성된 리뷰가 없습니다.</p>
                <p className="text-sm text-muted-foreground mt-2">첫 리뷰를 작성해보세요!</p>
            </div>
        )}

      </div>
      <EpisodeCommentDialog
        isOpen={isCommentDialogOpen}
        onOpenChange={setCommentDialogOpen}
        comments={comments}
        user={user}
        mode="view"
      />
    </>
  );
}
