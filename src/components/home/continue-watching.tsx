'use client';

import { useMemo } from 'react';
import { useUser, useFirestore, useCollection, useMemoFirebase } from '@/firebase/hooks';
import { collection, query, orderBy, limit, where } from 'firebase/firestore';
import type { Episode, EpisodeViewLog } from '@/lib/types';
import ContentCarousel from '@/components/shared/content-carousel';
import { Skeleton } from '@/components/ui/skeleton';

export default function ContinueWatching() {
    const { user } = useUser();
    const firestore = useFirestore();

    // Changed to query the correct 'episode_view_logs' collection for the current user.
    const historyQuery = useMemoFirebase(() => {
        if (!user || !firestore) return null;
        return query(
            collection(firestore, 'episode_view_logs'),
            where('userId', '==', user.id),
            orderBy('endedAt', 'desc'),
            limit(10)
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
        
        // Filter logs where watched duration is 5 seconds or more.
        const filteredLogs = viewLogs.filter(log => log.duration >= 5);

        // Get unique episode IDs from the filtered logs, maintaining order (most recent first)
        const uniqueEpisodeIds = [...new Set(filteredLogs.map(log => log.episodeId))];
        
        return uniqueEpisodeIds.map(episodeId => episodeMap.get(episodeId)).filter(Boolean) as Episode[];
    }, [viewLogs, allEpisodes]);
    
    const isLoading = historyLoading || episodesLoading;
    
    // Only render the component if the user is logged in.
    if (!user) {
        return null;
    }

    return (
        <section>
          <h2 className="mb-4 font-headline text-2xl font-semibold tracking-tight">
            최신 시청 기록
          </h2>
          {isLoading ? (
             <div className="flex space-x-4">
                <Skeleton className="h-64 w-1/4" />
                <Skeleton className="h-64 w-1/4" />
                <Skeleton className="h-64 w-1/4" />
                <Skeleton className="h-64 w-1/4" />
              </div>
          ) : watchedEpisodes.length > 0 ? (
            <ContentCarousel items={watchedEpisodes} itemType="episode" />
          ) : (
            <div className="flex items-center justify-center h-40 rounded-lg border-2 border-dashed bg-muted/50">
              <p className="text-muted-foreground">시청 기록이 없습니다. 비디오를 시청하면 여기에 표시됩니다.</p>
            </div>
          )}
        </section>
    );
}
