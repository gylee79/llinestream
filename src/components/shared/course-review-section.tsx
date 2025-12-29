'use client';
import { useState, useMemo } from 'react';
import type { EpisodeComment, User } from '@/lib/types';
import { Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toDisplayDate } from '@/lib/date-helpers';
import { Card, CardContent } from '../ui/card';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from '@/components/ui/carousel';
import EpisodeCommentDialog from './episode-comment-dialog';

const ReviewItem = ({ comment }: { comment: EpisodeComment }) => {
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
            <p className="text-sm mt-2 flex-grow line-clamp-3">{comment.content}</p>
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
  
  if (comments.length === 0) {
      return null;
  }

  return (
    <>
      <div className="mt-12">
        <div className="flex justify-between items-center mb-4">
          <h2 className="font-headline text-2xl font-bold">리뷰 ({totalReviews})</h2>
          <Button variant="outline" onClick={() => setCommentDialogOpen(true)}>모든 리뷰 보기</Button>
        </div>
        
        <Carousel opts={{ align: 'start', loop: false }} className="w-full h-full">
            <CarouselContent className="h-full -ml-4">
                {/* Rating Summary Item */}
                <CarouselItem className="md:basis-1/2 lg:basis-1/3 pl-4">
                    <div className="p-1 h-full">
                        <Card className="h-full">
                            <CardContent className="p-4 flex flex-col h-full items-start justify-center">
                                <span className="text-3xl font-bold">{averageRating.toFixed(1)}</span>
                                <div className="flex items-center my-1">
                                    {[1,2,3,4,5].map(star => (
                                        <Star key={star} className={cn("w-5 h-5", star <= averageRating ? 'text-yellow-400 fill-yellow-400' : 'text-muted-foreground/30')} />
                                    ))}
                                </div>
                                <span className="text-xs text-muted-foreground">{totalReviews}개 리뷰</span>
                                <div className="w-full mt-2 space-y-1">
                                    {ratingDistribution.map((percentage, index) => (
                                        <div key={index} className="flex items-center gap-2 text-xs text-muted-foreground">
                                            <span className="w-2">{5-index}</span>
                                            <div className="w-full bg-background rounded-full h-1.5">
                                                <div className="bg-yellow-400 h-1.5 rounded-full" style={{ width: `${percentage}%` }}></div>
                                            </div>
                                            <span className="w-6 text-right">{ratingCounts[index]}</span>
                                        </div>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                </CarouselItem>
                
                {/* Review Items */}
                {comments.map(comment => (
                    <CarouselItem key={comment.id} className="md:basis-1/2 lg:basis-1/3 pl-4">
                        <div className="p-1 h-full">
                            <ReviewItem comment={comment} />
                        </div>
                    </CarouselItem>
                ))}
            </CarouselContent>
            <CarouselPrevious className="hidden sm:flex" />
            <CarouselNext className="hidden sm:flex" />
        </Carousel>

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