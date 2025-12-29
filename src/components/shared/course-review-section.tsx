'use client';
import { useState, useMemo } from 'react';
import type { EpisodeComment } from '@/lib/types';
import { Star, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toDisplayDate } from '@/lib/date-helpers';
import { Card, CardContent } from '../ui/card';

interface CourseReviewSectionProps {
  comments: EpisodeComment[];
}

const ReviewItem = ({ comment }: { comment: EpisodeComment }) => {
    return (
        <div className="py-4 border-b">
            <div className="flex items-start gap-3">
                <div className="flex-1">
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
                    <p className="text-sm mt-2 whitespace-pre-wrap">{comment.content}</p>
                </div>
            </div>
        </div>
    )
}

export default function CourseReviewSection({ comments }: CourseReviewSectionProps) {
  const [showAll, setShowAll] = useState(false);

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
    const distribution = counts.map(d => (d/totalReviews)*100)

    return { averageRating, totalReviews, ratingDistribution: distribution, ratingCounts: counts };
  }, [comments]);
  
  const displayedComments = showAll ? comments : comments.slice(0, 4);

  if (comments.length === 0) {
      return null;
  }

  return (
    <div className="mt-12">
      <h2 className="font-headline text-2xl font-bold mb-4">리뷰 ({totalReviews})</h2>
      <div className="grid grid-cols-1 md:grid-cols-5 gap-8">
        {/* Left Side: Rating Summary */}
        <div className="md:col-span-2 flex flex-col items-start justify-start bg-muted/50 p-6 rounded-lg">
            <span className="text-4xl font-bold">{averageRating.toFixed(1)}</span>
            <div className="flex items-center my-1">
                {[1,2,3,4,5].map(star => (
                    <Star key={star} className={cn("w-5 h-5", star <= averageRating ? 'text-yellow-400 fill-yellow-400' : 'text-muted-foreground/30')} />
                ))}
            </div>
            <span className="text-sm text-muted-foreground">{totalReviews}개 리뷰</span>
            <div className="w-full mt-4 space-y-1">
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
        </div>

        {/* Right Side: Review List */}
        <div className="md:col-span-3">
            {displayedComments.map(comment => (
                <ReviewItem key={comment.id} comment={comment} />
            ))}
             {comments.length > 4 && (
                <div className="mt-6 text-center">
                    <Button variant="outline" onClick={() => setShowAll(!showAll)}>
                        {showAll ? (
                            <>
                                <ChevronUp className="mr-2 h-4 w-4" />
                                리뷰 접기
                            </>
                        ) : (
                            <>
                                {`모든 리뷰 보기 (${comments.length}개)`}
                                <ChevronDown className="ml-2 h-4 w-4" />
                            </>
                        )}
                    </Button>
                </div>
            )}
        </div>
      </div>
    </div>
  );
}
