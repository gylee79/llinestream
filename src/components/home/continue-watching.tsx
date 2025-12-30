'use client';

import { useMemo } from 'react';
import { useUser, useFirestore, useCollection, useMemoFirebase } from '@/firebase/hooks';
import { collection, query, orderBy, limit } from 'firebase/firestore';
import type { Episode, ViewHistoryItem } from '@/lib/types';
import ContentCarousel from '@/components/shared/content-carousel';
import { Skeleton } from '@/components/ui/skeleton';

export default function ContinueWatching() {
    const { user } = useUser();
    const firestore = useFirestore();

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

        const episodeMap = new Map(allEpisodes.map(e => [e.id, e]));
        
        const filteredHistory = historyItems.filter(item => {
            const episode = episodeMap.get(item.id);
            if (!episode) return false;
            // progress is 0 to 1, duration is in seconds
            const watchedSeconds = item.progress * episode.duration;
            // Only include if watched for at least 5 seconds
            return watchedSeconds >= 5;
        });
        
        // Get unique episode IDs from the filtered history, maintaining order (most recent first)
        const uniqueEpisodeIds = [...new Set(filteredHistory.map(item => item.id))];
        
        return uniqueEpisodeIds.map(episodeId => episodeMap.get(episodeId)).filter(Boolean) as Episode[];
    }, [historyItems, allEpisodes]);
    
    const isLoading = historyLoading || episodesLoading;

    if (isLoading) {
        return (
            <section>
              <h2 className="mb-4 font-headline text-2xl font-semibold tracking-tight">최신 시청 기록</h2>
              <div className="flex space-x-4">
                <Skeleton className="h-64 w-1/4" />
                <Skeleton className="h-64 w-1/4" />
                <Skeleton className="h-64 w-1/4" />
                <Skeleton className="h-64 w-1/4" />
              </div>
            </section>
        );
    }
    
    return (
        <section>
          <h2 className="mb-4 font-headline text-2xl font-semibold tracking-tight">
            최신 시청 기록
          </h2>
          {watchedEpisodes && watchedEpisodes.length > 0 ? (
            <ContentCarousel items={watchedEpisodes} itemType="episode" />
          ) : (
            <div className="flex items-center justify-center h-40 rounded-lg border-2 border-dashed bg-muted/50">
              <p className="text-muted-foreground">시청 기록이 없습니다. 비디오를 시청하면 여기에 표시됩니다.</p>
            </div>
          )}
        </section>
    );
}
