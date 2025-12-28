
'use client';

import { useMemo } from 'react';
import { useUser, useFirestore, useCollection, useMemoFirebase } from '@/firebase/hooks';
import { collection, query, orderBy, limit } from 'firebase/firestore';
import type { ViewHistoryItem, Course, Episode } from '@/lib/types';
import ContentCarousel from '@/components/shared/content-carousel';
import { Skeleton } from '@/components/ui/skeleton';

export default function ContinueWatching() {
    const { user } = useUser();
    const firestore = useFirestore();

    const mockEpisodes: Episode[] = [
        { id: 'ep-001', courseId: 'course-001', title: '1. React 소개 및 환경 설정', duration: 980, isFree: true, videoUrl: '', thumbnailUrl: 'https://picsum.photos/seed/ep-001/600/400', createdAt: new Date() },
        { id: 'ep-008', courseId: 'course-003', title: 'Week 1: 기본 자세 익히기', duration: 1800, isFree: true, videoUrl: '', thumbnailUrl: 'https://picsum.photos/seed/ep-008/600/400', createdAt: new Date() },
        { id: 'ep-015', courseId: 'course-007', title: '1. 인사와 소개', duration: 1300, isFree: true, videoUrl: '', thumbnailUrl: 'https://picsum.photos/seed/ep-015/600/400', createdAt: new Date() },
        { id: 'ep-019', courseId: 'course-009', title: '1. Express.js 시작하기', duration: 1200, isFree: true, videoUrl: '', thumbnailUrl: 'https://picsum.photos/seed/ep-019/600/400', createdAt: new Date() },
    ];
    
    
    const historyQuery = useMemoFirebase(() => {
        if (!user || !firestore) return null;
        return query(
            collection(firestore, 'users', user.id, 'viewHistory'),
            orderBy('lastWatched', 'desc'),
            limit(10)
        );
    }, [user, firestore]);

    const { data: historyItems, isLoading: historyLoading } = useCollection<ViewHistoryItem>(historyQuery);

    const episodesQuery = useMemoFirebase(() => {
        if (!firestore) return null;
        return collection(firestore, 'episodes');
    }, [firestore]);
    
    const { data: allEpisodes, isLoading: episodesLoading } = useCollection<Episode>(episodesQuery);

    const watchedEpisodes = useMemo(() => {
        if (!historyItems || !allEpisodes) return [];
        // Get unique episode IDs from history, preserving order
        const uniqueEpisodeIds = [...new Set(historyItems.map(item => item.id))];
        // Map episode IDs to actual episode objects
        return uniqueEpisodeIds.map(episodeId => allEpisodes.find(e => e.id === episodeId)).filter(Boolean) as Episode[];
    }, [historyItems, allEpisodes]);
    
    const isLoading = historyLoading || episodesLoading;
    const finalItems = (watchedEpisodes && watchedEpisodes.length > 0) ? watchedEpisodes : mockEpisodes;


    if (isLoading) {
        return (
            <div className="space-y-4">
              <Skeleton className="h-8 w-1/4" />
              <div className="flex space-x-4">
                <Skeleton className="h-64 w-1/4" />
                <Skeleton className="h-64 w-1/4" />
                <Skeleton className="h-64 w-1/4" />
                <Skeleton className="h-64 w-1/4" />
              </div>
            </div>
        );
    }
    
    if (finalItems.length === 0) {
        return null;
    }

    return (
        <ContentCarousel title="최근 시청 영상" items={finalItems} itemType="episode" />
    );
}

    
