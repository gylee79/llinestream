'use client';
import { useState, useMemo } from 'react';
import type { EpisodeComment } from '@/lib/types';
import { Star, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { toDisplayDate } from '@/lib/date-helpers';

interface CourseReviewSectionProps {
  comments: EpisodeComment[];
}

const ReviewItem = ({ comment }: { comment: EpisodeComment }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    
    // Show only first 2 lines initially
    const canTruncate = comment.content.split('\n').length > 2 || comment.content.length > 100;
    const displayText = isExpanded ? comment.content : comment.content.split('\n').slice(0, 2).join('\n').substring(0, 100) + (canTruncate ? '...' : '');

    return (
        <div className="py-4 border-b">
            <div className="flex items-start gap-3">
                <Avatar className="h-8 w-8">
                  <AvatarFallback>{comment.userName.charAt(0)}</AvatarFallback>
                </Avatar>
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
                    <p className="text-sm mt-2 whitespace-pre-wrap">{displayText}</p>
                    {canTruncate && (
                         <Button variant="ghost" size="sm" onClick={() => setIsExpanded(!isExpanded)} className="h-auto p-1 text-muted-foreground">
                            {isExpanded ? '접기' : '더보기'}
                         </Button>
                    )}
                </div>
            </div>
        </div>
    )
}

export default function CourseReviewSection({ comments }: CourseReviewSectionProps) {
  const [showAll, setShowAll] = useState(false);

  const { averageRating, totalReviews, ratingDistribution } = useMemo(() => {
    const ratedComments = comments.filter(c => c.rating && c.rating > 0);
    const totalReviews = ratedComments.length;
    if (totalReviews === 0) {
      return { averageRating: 0, totalReviews: 0, ratingDistribution: [0, 0, 0, 0, 0] };
    }
    const totalRating = ratedComments.reduce((sum, c) => sum + c.rating!, 0);
    const averageRating = totalRating / totalReviews;
    
    const distribution = [0,0,0,0,0];
    ratedComments.forEach(c => {
        if(c.rating) distribution[5-c.rating] += 1;
    })

    return { averageRating, totalReviews, ratingDistribution: distribution.map(d => (d/totalReviews)*100) };
  }, [comments]);
  
  const displayedComments = showAll ? comments : comments.slice(0, 3);

  if (comments.length === 0) {
      return null; // Don't render section if there are no comments
  }

  return (
    <div className="mt-12">
      <h2 className="font-headline text-2xl font-bold">리뷰</h2>
      <div className="flex items-center gap-4 mt-4">
        <div className="flex items-baseline">
            <Star className="w-8 h-8 text-yellow-400 fill-yellow-400 mr-2" />
            <span className="text-4xl font-bold">{averageRating.toFixed(1)}</span>
        </div>
        <div className="flex-grow">
            {ratingDistribution.map((percentage, index) => (
                 <div key={index} className="flex items-center gap-2 text-xs">
                    <span className="w-2">{5-index}</span>
                    <div className="w-full bg-muted rounded-full h-1.5">
                        <div className="bg-yellow-400 h-1.5 rounded-full" style={{ width: `${percentage}%` }}></div>
                    </div>
                 </div>
            ))}
        </div>
        <p className="text-muted-foreground text-sm">{totalReviews}개 리뷰</p>
      </div>

      <div className="mt-6">
        {displayedComments.map(comment => (
            <ReviewItem key={comment.id} comment={comment} />
        ))}
      </div>
      
      {comments.length > 3 && (
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
  );
}
