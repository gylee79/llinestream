
'use client';

import Image from 'next/image';
import { useState, useMemo } from 'react';
import { Lock, Play, MessageSquare, Star, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { Episode, Instructor, Classification, User, EpisodeComment } from '@/lib/types';
import VideoPlayerDialog from '@/components/shared/video-player-dialog';
import PaymentDialog from '@/components/shared/payment-dialog';
import EpisodeCommentDialog from '@/components/shared/episode-comment-dialog';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { toDisplayDate } from '@/lib/date-helpers';

interface EpisodeListItemProps {
    episode: Episode;
    instructor?: Instructor;
    isPlayable: boolean;
    classification: Classification | null;
    user: User | null;
    comments: EpisodeComment[];
}

const formatDuration = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
};

export default function EpisodeListItem({ episode, instructor, isPlayable, classification, user, comments }: EpisodeListItemProps) {
    const [isPlayerOpen, setPlayerOpen] = useState(false);
    const [isPaymentOpen, setPaymentOpen] = useState(false);
    const [isCommentOpen, setCommentOpen] = useState(false);
    const [isReviewExpanded, setReviewExpanded] = useState(false);

    const averageRating = useMemo(() => {
        if (!comments || comments.length === 0) return 0;
        const ratedComments = comments.filter(c => c.rating);
        if (ratedComments.length === 0) return 0;
        const totalRating = ratedComments.reduce((acc, c) => acc + (c.rating || 0), 0);
        return totalRating / ratedComments.length;
    }, [comments]);
    
    const representativeComment = comments.length > 0 ? comments[0] : null;

    const handlePlayClick = () => {
        if (isPlayable) {
            setPlayerOpen(true);
        } else {
            setPaymentOpen(true);
        }
    };
    
    return (
        <>
            <Card className="overflow-hidden">
                <CardContent className="p-4 flex flex-col sm:flex-row gap-4">
                    <div className="relative aspect-video w-full sm:w-48 flex-shrink-0 bg-muted rounded-md overflow-hidden">
                        <Image src={episode.thumbnailUrl} alt={episode.title} fill sizes="(max-width: 640px) 100vw, 192px" className="object-cover" />
                        <div className="absolute bottom-1 right-1 bg-black/60 text-white text-xs px-1.5 py-0.5 rounded">
                            {formatDuration(episode.duration)}
                        </div>
                    </div>
                    <div className="flex-grow">
                        <div className="flex justify-between">
                            <Badge variant={episode.isFree ? 'default' : 'secondary'}>{episode.isFree ? '무료' : '구독필요'}</Badge>
                            {averageRating > 0 && (
                                 <div className="flex items-center gap-1 text-xs">
                                    <Star className="w-4 h-4 text-yellow-400 fill-yellow-400" />
                                    <span className="font-bold">{averageRating.toFixed(1)}</span>
                                    <span className="text-muted-foreground">({comments.length})</span>
                                </div>
                            )}
                        </div>
                        <h3 className="text-lg font-bold mt-1">{episode.title}</h3>
                        {instructor && <p className="text-sm text-muted-foreground mt-1">강사: {instructor.name}</p>}
                        
                        {representativeComment && (
                             <div className="text-sm mt-3 border-t pt-3">
                                <div className="flex gap-2 items-center">
                                    <Avatar className="h-5 w-5">
                                        <AvatarFallback>{representativeComment.userName.charAt(0)}</AvatarFallback>
                                    </Avatar>
                                    <p className={cn("truncate", !isReviewExpanded && "line-clamp-1")}>
                                        {representativeComment.content}
                                    </p>
                                </div>
                                <Button variant="link" size="sm" className="h-auto p-0 text-muted-foreground" onClick={() => setReviewExpanded(!isReviewExpanded)}>
                                    {isReviewExpanded ? '접기' : '펼침'}
                                </Button>
                             </div>
                        )}
                    </div>
                    <div className="flex-shrink-0 flex sm:flex-col items-center justify-start gap-2">
                        <Button className="w-full" onClick={handlePlayClick}>
                           {isPlayable ? <Play className="mr-2 h-4 w-4" /> : <Lock className="mr-2 h-4 w-4" />}
                           시청하기
                        </Button>
                        <Button variant="outline" className="w-full" onClick={() => setCommentOpen(true)}>
                            <MessageSquare className="mr-2 h-4 w-4"/>
                            리뷰
                        </Button>
                    </div>
                </CardContent>
            </Card>

            <VideoPlayerDialog 
                isOpen={isPlayerOpen}
                onOpenChange={setPlayerOpen}
                episode={episode}
                instructor={instructor || null}
            />
            {user && (
                <EpisodeCommentDialog 
                    isOpen={isCommentOpen}
                    onOpenChange={setCommentOpen}
                    episode={episode}
                    user={user}
                />
            )}
            {!isPlayable && classification && (
                <PaymentDialog 
                    open={isPaymentOpen}
                    onOpenChange={setPaymentOpen}
                    item={classification}
                    itemType="classification"
                    selectedDuration="day30"
                    selectedPrice={classification.prices.day30}
                    selectedLabel="30일 이용권"
                >
                    <div></div>
                </PaymentDialog>
            )}
        </>
    );
}
