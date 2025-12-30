'use client';

import { useMemo } from 'react';
import { useUser, useFirestore, useCollection, useMemoFirebase } from '@/firebase/hooks';
import { collection, query, limit, where } from 'firebase/firestore';
import type { Episode, EpisodeViewLog } from '@/lib/types';
import ContentCarousel from '@/components/shared/content-carousel';
import { Skeleton } from '@/components/ui/skeleton';
import { toJSDate } from '@/lib/date-helpers';

export default function ContinueWatching() {
    const { user } = useUser();
    const firestore = useFirestore();

    // Fetch logs for the current user. NOTE: We sort on the client to avoid complex security rules.
    const historyQuery = useMemoFirebase(() => {
        if (!user || !firestore) return null;
        return query(
            collection(firestore, 'episode_view_logs'),
            where('userId', '==', user.id),
            // orderBy is removed to comply with security rules.
            // We will sort manually on the client.
            limit(30) // Fetch more items to sort from, as we can't rely on DB ordering.
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

        // Sort on the client side by endedAt date, descending.
        const sortedLogs = filteredLogs.sort((a, b) => toJSDate(b.endedAt).getTime() - toJSDate(a.endedAt).getTime());

        // Get unique episode IDs from the sorted logs, maintaining order (most recent first)
        const uniqueEpisodeIds = [...new Set(sortedLogs.map(log => log.episodeId))];
        
        return uniqueEpisodeIds.slice(0, 10).map(episodeId => episodeMap.get(episodeId)).filter(Boolean) as Episode[];
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
