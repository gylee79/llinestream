'use client';

import Image from 'next/image';
import { useState, useMemo } from 'react';
import { Lock, Play, Star, Clock, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { Episode, Instructor, Course, User, EpisodeComment } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useDoc, useFirestore, useMemoFirebase } from '@/firebase';
import { doc } from 'firebase/firestore';
import { toJSDate } from '@/lib/date-helpers';
import dynamic from 'next/dynamic';

const VideoPlayerDialog = dynamic(() => import('@/components/shared/video-player-dialog'));
const PaymentDialog = dynamic(() => import('@/components/shared/payment-dialog'));
const EpisodeCommentDialog = dynamic(() => import('@/components/shared/episode-comment-dialog'));


const formatDuration = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
};

interface EpisodeListItemProps {
    episode: Episode;
    instructor?: Instructor;
    user: User | null;
    comments: EpisodeComment[];
    hasBeenWatched?: boolean;
}

export default function EpisodeListItem({ episode, instructor, user, comments, hasBeenWatched = false }: EpisodeListItemProps) {
    const firestore = useFirestore();
    const [isPlayerOpen, setPlayerOpen] = useState(false);
    const [isPaymentOpen, setPaymentOpen] = useState(false);
    const [isCommentOpen, setCommentOpen] = useState(false);
    
    const courseRef = useMemoFirebase(() => (firestore ? doc(firestore, 'courses', episode.courseId) : null), [firestore, episode.courseId]);
    const { data: course, isLoading: courseLoading } = useDoc<Course>(courseRef);

    const subscription = user?.activeSubscriptions?.[episode.courseId];
    const isSubscriptionActive = subscription ? new Date() < (toJSDate(subscription.expiresAt) || new Date(0)) : false;
    
    const isPlayable = !!(episode.isFree || isSubscriptionActive);

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
        if (courseLoading) return;
        if (isPlayable) {
            setPlayerOpen(true);
        } else if (user) { // Only open payment dialog if user is logged in
            setPaymentOpen(true);
        } else {
            // Or redirect to login
            // For now, nothing happens, as the lock icon suggests it's not available.
        }
    };
    
    return (
        <>
            <Card className="overflow-hidden border-primary/50 shadow-md transition-shadow hover:shadow-lg rounded-lg">
                <CardContent className="p-3">
                     <div className="flex gap-3">
                        {/* Left Column */}
                        <div className="flex-grow flex flex-col min-w-0">
                            <div className="mt-2 md:mt-0">
                                <h3 className="font-headline text-base font-bold leading-tight tracking-tight line-clamp-2">{episode.title}</h3>
                                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{episode.description}</p>
                            </div>
                            <div className="flex items-center gap-4 text-[10px] md:text-[11px] text-muted-foreground mt-2">
                                <p>강사: {instructor?.name || 'N/A'}</p>
                                <div className="flex items-center gap-1">
                                    <Clock className="w-3 h-3" />
                                    <span>{formatDuration(episode.duration)}</span>
                                </div>
                                {!episode.isFree && (
                                    <Badge variant="secondary" className="h-5 px-1.5 py-0 text-[10px] md:text-xs">구독필요</Badge>
                                )}
                            </div>
                        </div>

                        {/* Right Column */}
                        <div className="flex-shrink-0 flex flex-col items-center gap-1.5 w-24">
                            <div className="w-full flex justify-end items-center h-6 gap-2">
                                <div className="flex items-center gap-1 text-[11px] md:text-xs text-muted-foreground">
                                    {ratedCommentsCount > 0 ? (
                                        <>
                                            <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />
                                            <span className="font-semibold text-foreground">{averageRating.toFixed(1)}</span>
                                            <span>({ratedCommentsCount})</span>
                                        </>
                                    ) : (
                                        <div className="w-12 h-4"/> 
                                    )}
                                </div>
                                <Button
                                    variant="link"
                                    className="h-auto p-0 text-[11px] md:text-xs text-muted-foreground"
                                    onClick={() => user && setCommentOpen(true)}
                                    disabled={!user}
                                >
                                    <span className="flex items-center">
                                      리뷰<Pencil className="h-2.5 w-2.5" />
                                    </span>
                                </Button>
                            </div>
                            <div className="relative aspect-video w-full bg-muted rounded-md overflow-hidden cursor-pointer border border-black/10" onClick={handlePlayClick}>
                                <Image 
                                    src={episode.thumbnailUrl} 
                                    alt={episode.title} 
                                    fill sizes="96px" 
                                    className="object-cover"
                                />
                                {!isPlayable && (
                                    <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                                        <Lock className="h-6 w-6 text-white" />
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {isPlayerOpen && (
                <VideoPlayerDialog 
                    isOpen={isPlayerOpen}
                    onOpenChange={setPlayerOpen}
                    episode={episode}
                    instructor={instructor || null}
                />
            )}

            {isCommentOpen && user && (
                <EpisodeCommentDialog 
                    isOpen={isCommentOpen}
                    onOpenChange={setCommentOpen}
                    episode={episode}
                    user={user}
                />
            )}
            {!isPlayable && user && course && (
                <PaymentDialog 
                    open={isPaymentOpen}
                    onOpenChange={setPaymentOpen}
                    item={course}
                    itemType="course"
                >
                    <div></div>
                </PaymentDialog>
            )}
        </>
    );
}