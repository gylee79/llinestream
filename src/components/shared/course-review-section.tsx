
'use client';
import { useState, useMemo } from 'react';
import type { EpisodeComment, User, Episode } from '@/lib/types';
import { Star, ChevronDown, ChevronUp } from 'lucide-react';
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
import { ScrollArea } from '../ui/scroll-area';

const ReviewItem = ({ comment, episodeTitle, isMobile = false }: { comment: EpisodeComment, episodeTitle?: string, isMobile?: boolean }) => {
    const [isExpanded, setIsExpanded] = useState(false);

    const toggleExpanded = () => setIsExpanded(!isExpanded);
    
    return (
        <Card className="h-full">
          <CardContent className="p-2 flex flex-col h-full">
            <p className="text-primary font-semibold text-xs truncate" title={episodeTitle}>{episodeTitle}</p>
            <div className="flex flex-col mt-1">
                <span className="font-semibold text-[10px] truncate">{comment.userName}</span>
                <span className="text-[9px] text-muted-foreground">{toDisplayDate(comment.createdAt)}</span>
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
                "text-xs mt-1 flex-grow",
                !isExpanded && "line-clamp-3",
                isMobile && "cursor-pointer"
              )}
              onClick={isMobile ? toggleExpanded : undefined}
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
  episodes: Episode[];
  onToggleAllReviews: () => void;
}

export default function CourseReviewSection({ comments, user, episodes, onToggleAllReviews }: CourseReviewSectionProps) {
  const [isReviewExpanded, setReviewExpanded] = useState(false);

  const toggleReviewExpansion = () => {
    setReviewExpanded(!isReviewExpanded);
  }

  const { averageRating, totalReviews } = useMemo(() => {
    const ratedComments = comments.filter(c => c.rating && c.rating > 0);
    const totalReviewsWithRating = ratedComments.length;
    if (totalReviewsWithRating === 0) {
      return { averageRating: 0, totalReviews: comments.length };
    }
    const totalRating = ratedComments.reduce((sum, c) => sum + c.rating!, 0);
    const averageRating = totalRating / totalReviewsWithRating;
    
    return { averageRating, totalReviews: comments.length };
  }, [comments]);
  
  const hasReviews = comments.length > 0;
  const recentThreeReviews = useMemo(() => comments.slice(0, 3), [comments]);
  const episodeMap = useMemo(() => new Map(episodes.map(e => [e.id, e.title])), [episodes]);

  return (
    <>
      <div className="mt-3">
        <div className="flex justify-between items-center mb-4">
          <h2 className="font-headline font-bold">
            <span className="md:text-2xl text-xl">리뷰</span>
            <span className="md:text-2xl text-lg"> ({totalReviews})</span>
          </h2>
          <Button variant="ghost" onClick={toggleReviewExpansion}>
            {isReviewExpanded ? '숨기기' : '리뷰 보기'}
            {isReviewExpanded ? <ChevronUp className="h-4 w-4 ml-2" /> : <ChevronDown className="h-4 w-4 ml-2" />}
          </Button>
        </div>
        
        {isReviewExpanded && (
          <>
            {hasReviews ? (
              <>
                {/* PC Layout: Carousel */}
                <div className="hidden md:grid grid-cols-1 md:grid-cols-5 gap-8 items-stretch">
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
                            <span className="text-xs text-muted-foreground">{comments.filter(c => c.rating).length}개 리뷰</span>
                        </CardContent>
                    </Card>
                </div>

                {/* Reviews Carousel */}
                <div className="md:col-span-4">
                    <Carousel opts={{ align: 'start', loop: false }} className="w-full">
                        <CarouselContent className="-ml-4">
                            {comments.map((comment) => (
                            <CarouselItem key={comment.id} className="md:basis-1/2 lg:basis-1/3 pl-4">
                                    <ReviewItem 
                                    comment={comment} 
                                    episodeTitle={episodeMap.get(comment.episodeId)} 
                                    />
                            </CarouselItem>
                            ))}
                        </CarouselContent>
                        <CarouselPrevious className="hidden sm:flex" />
                        <CarouselNext className="hidden sm:flex" />
                    </Carousel>
                </div>
              </div>
              {/* Mobile Layout: Grid */}
              <div className="grid md:hidden grid-cols-4 gap-2">
                <Card className="h-full col-span-1">
                  <CardContent className="p-2 flex flex-col h-full items-center justify-center text-center">
                    <span className="text-2xl font-bold">{averageRating.toFixed(1)}</span>
                    <div className="flex items-center my-1">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <Star key={star} className={cn("w-3 h-3", star <= averageRating ? 'text-yellow-400 fill-yellow-400' : 'text-muted-foreground/30')} />
                      ))}
                    </div>
                    <span className="text-[10px] text-muted-foreground">{comments.filter(c => c.rating).length}개 리뷰</span>
                  </CardContent>
                </Card>
                {recentThreeReviews.map(comment => (
                  <div key={comment.id} className="col-span-1">
                    <ReviewItem 
                      comment={comment} 
                      episodeTitle={episodeMap.get(comment.episodeId)}
                      isMobile={true} 
                    />
                  </div>
                ))}
              </div>
              </>
            ) : (
                <div className="text-center py-16 border rounded-lg bg-muted/50">
                    <p className="text-muted-foreground">아직 작성된 리뷰가 없습니다.</p>
                    <p className="text-sm text-muted-foreground mt-2">첫 리뷰를 작성해보세요!</p>
                </div>
            )}
            
            {hasReviews && (
              <div className="mt-4 flex justify-center">
                <Button variant="outline" onClick={onToggleAllReviews}>
                  전체 리뷰 보기 ({totalReviews})
                </Button>
              </div>
            )}
          </>
        )}

      </div>
    </>
  );
}
