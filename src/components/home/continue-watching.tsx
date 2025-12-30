'use client';

import { useMemo } from 'react';
import { useUser, useFirestore, useCollection, useMemoFirebase } from '@/firebase/hooks';
import { collection, query, limit, orderBy } from 'firebase/firestore';
import type { Episode, EpisodeViewLog } from '@/lib/types';
import ContentCarousel from '@/components/shared/content-carousel';
import { Skeleton } from '@/components/ui/skeleton';
import { toJSDate } from '@/lib/date-helpers';

export default function ContinueWatching() {
    const { user } = useUser();
    const firestore = useFirestore();

    const historyQuery = useMemoFirebase(() => {
        if (!user || !firestore) return null;
        return query(
            collection(firestore, 'users', user.id, 'viewHistory'),
            orderBy('endedAt', 'desc'),
            limit(20) // Fetch more to account for client-side deduplication
        );
    }, [user, firestore]);

    const { data: viewLogs, isLoading: historyLoading } = useCollection<EpisodeViewLog>(historyQuery);

    const episodesQuery = useMemoFirebase(() => {
        if (!firestore) return null;
        return collection(firestore, 'episodes');
    }, [firestore]);
    
    const { data: allEpisodes, isLoading: episodesLoading } = useCollection<Episode>(episodesQuery);

    const watchedEpisodes = useMemo(() => {
        if (!viewLogs || !allEpisodes) return [];
        
        const episodeMap = new Map(allEpisodes.map(e => [e.id, e]));
        
        const validLogs = viewLogs.filter(log => log.duration >= 5);

        // Get unique episode IDs from the sorted logs, maintaining order (most recent first)
        const uniqueEpisodeIds = [...new Set(validLogs.map(log => log.episodeId))];
        
        return uniqueEpisodeIds.slice(0, 10).map(episodeId => episodeMap.get(episodeId)).filter(Boolean) as Episode[];
    }, [viewLogs, allEpisodes]);
    
    const isLoading = historyLoading || episodesLoading;
    
    if (!user) {
        return null;
    }

    if (isLoading) {
        return (
            <div className="flex space-x-4">
                <Skeleton className="h-64 w-1/4" />
                <Skeleton className="h-64 w-1/4" />
                <Skeleton className="h-64 w-1/4" />
                <Skeleton className="h-64 w-1/4" />
            </div>
        );
    }

    if (watchedEpisodes.length === 0) {
        return (
            <div className="flex items-center justify-center h-40 rounded-lg border-2 border-dashed bg-muted/50">
                <p className="text-muted-foreground">비디오 시청을 시작하시면 편하게 최신 영상을 보실수 있게 도와드립니다.</p>
            </div>
        );
    }

    return (
        <ContentCarousel title="최근 시청 영상" items={watchedEpisodes} itemType="episode" />
    );
}
