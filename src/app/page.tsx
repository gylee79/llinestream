
'use client';
import Hero from '@/components/home/hero';
import { useCollection, useDoc, useFirestore, useUser, useMemoFirebase } from '@/firebase/hooks';
import { collection, doc, query, orderBy } from 'firebase/firestore';
import { Course, Classification, Episode, HeroImageSettings, Field, EpisodeViewLog } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import ClassificationCard from '@/components/shared/classification-card';
import ContentCarousel from '@/components/shared/content-carousel';
import { useMemo } from 'react';
import EpisodeCard from '@/components/shared/episode-card';

export default function Home() {
  const firestore = useFirestore();
  const { user } = useUser();

  const fieldsQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'fields') : null), [firestore]);
  const { data: fields, isLoading: fieldsLoading } = useCollection<Field>(fieldsQuery);

  const classificationsQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'classifications') : null), [firestore]);
  const { data: classifications, isLoading: classificationsLoading } = useCollection<Classification>(classificationsQuery);
  
  const heroImagesRef = useMemoFirebase(() => (firestore ? doc(firestore, 'settings', 'heroImages') : null), [firestore]);
  const { data: heroImagesData, isLoading: heroImagesLoading } = useDoc<HeroImageSettings>(heroImagesRef);

  const viewLogsQuery = useMemoFirebase(() => {
      if (!user || !firestore) return null;
      return query(
          collection(firestore, 'users', user.id, 'viewHistory'),
          orderBy('endedAt', 'desc')
      );
  }, [user, firestore]);
  const { data: viewLogs, isLoading: historyLoading } = useCollection<EpisodeViewLog>(viewLogsQuery);

  const episodesQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'episodes') : null), [firestore]);
  const { data: allEpisodes, isLoading: episodesLoading } = useCollection<Episode>(episodesQuery);

  const watchedEpisodes = useMemo(() => {
      if (!viewLogs || !allEpisodes) return [];
      const episodeMap = new Map(allEpisodes.map(e => [e.id, e]));
      const validLogs = viewLogs.filter(log => log.duration >= 5);
      const uniqueEpisodeIds = [...new Set(validLogs.map(log => log.episodeId))];
      return uniqueEpisodeIds.map(episodeId => episodeMap.get(episodeId)).filter(Boolean) as Episode[];
  }, [viewLogs, allEpisodes]);


  const isLoading = fieldsLoading || classificationsLoading || heroImagesLoading || (user && (historyLoading || episodesLoading));
  
  if (isLoading) {
      return (
          <div>
            <Skeleton className="h-[70vh] w-full" />
            <div className="container mx-auto py-12 space-y-12">
                <Skeleton className="h-8 w-1/4" />
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    <Skeleton className="h-48 w-full" />
                    <Skeleton className="h-48 w-full" />
                    <Skeleton className="h-48 w-full" />
                    <Skeleton className="h-48 w-full" />
                </div>
            </div>
          </div>
      )
  }

  return (
    <div className="flex-1">
      <Hero 
          title={heroImagesData?.home?.title}
          description={heroImagesData?.home?.description}
          imageUrl={heroImagesData?.home?.url}
          imageUrlMobile={heroImagesData?.home?.urlMobile}
        />
      <div className="container mx-auto space-y-10 md:space-y-12 py-12">
        {user && watchedEpisodes.length > 0 && (
          <ContentCarousel
            title="시청 기록"
            items={watchedEpisodes}
            itemType="episode"
          />
        )}
        {fields?.map((field) => {
          const classificationsInField = classifications?.filter(
            (c) => c.fieldId === field.id
          );
          
          if (!classificationsInField || classificationsInField.length === 0) return null;

          return (
            <section key={field.id}>
              <ContentCarousel
                title={field.name}
                items={classificationsInField}
                itemType="classification"
              />
            </section>
          );
        })}
      </div>
    </div>
  );
}
