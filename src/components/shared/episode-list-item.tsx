
'use client';

import Image from 'next/image';
import { useState, useMemo } from 'react';
import { Lock, Play, Star, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { Episode, Instructor, Classification, User, EpisodeComment } from '@/lib/types';
import VideoPlayerDialog from '@/components/shared/video-player-dialog';
import PaymentDialog from '@/components/shared/payment-dialog';
import EpisodeCommentDialog from '@/components/shared/episode-comment-dialog';

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

    const { averageRating, ratedCommentsCount } = useMemo(() => {
        if (!comments || comments.length === 0) return { averageRating: 0, ratedCommentsCount: 0 };
        const ratedComments = comments.filter(c => c.rating && c.rating > 0);
        if (ratedComments.length === 0) return { averageRating: 0, ratedCommentsCount: 0 };
        const totalRating = ratedComments.reduce((acc, c) => acc + (c.rating || 0), 0);
        return { 
            averageRating: totalRating / ratedComments.length,
            ratedCommentsCount: ratedComments.length
        };
    }, [comments]);
    
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
                <CardContent className="p-3 flex items-center gap-3">
                    <div className="flex-grow space-y-1">
                       <h3 className="text-sm font-bold leading-tight line-clamp-2 sm:text-base">{episode.title}</h3>
                       <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                           {!episode.isFree && <Badge variant="secondary" className="h-5 px-1.5 py-0">구독필요</Badge>}
                           {instructor && <p className="flex-shrink-0">{`강사: ${instructor.name}`}</p>}
                           <div className="flex items-center gap-1">
                               <Clock className="w-3 h-3" />
                               <span>{formatDuration(episode.duration)}</span>
                           </div>
                           {ratedCommentsCount > 0 && (
                                <div className="flex items-center gap-1">
                                    <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />
                                    <span className="font-semibold text-foreground">{averageRating.toFixed(1)}</span>
                                    <span>({ratedCommentsCount})</span>
                                </div>
                            )}
                       </div>
                       <Button
                            variant="link"
                            className="h-auto p-0 text-xs text-muted-foreground"
                            onClick={() => user && setCommentOpen(true)}
                            disabled={!user}
                        >
                            리뷰 작성
                        </Button>
                    </div>
                     <div className="relative aspect-video w-24 flex-shrink-0 bg-muted rounded-md overflow-hidden">
                        <Image src={episode.thumbnailUrl} alt={episode.title} fill sizes="96px" className="object-cover" />
                    </div>
                    <div className="flex-shrink-0">
                        <Button className="w-20" size="sm" onClick={handlePlayClick}>
                           {isPlayable ? <Play className="mr-1.5 h-4 w-4" /> : <Lock className="mr-1.5 h-4 w-4" />}
                           시청
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {isPlayable && (
                <VideoPlayerDialog 
                    isOpen={isPlayerOpen}
                    onOpenChange={setPlayerOpen}
                    episode={episode}
                    instructor={instructor || null}
                />
            )}

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
