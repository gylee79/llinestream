'use client';
import Hero from '@/components/home/hero';
import { useCollection, useDoc, useFirestore, useUser, useMemoFirebase } from '@/firebase/hooks';
import { collection, doc } from 'firebase/firestore';
import { Course, Classification, Episode, HeroImageSettings, Field } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import ClassificationCard from '@/components/shared/classification-card';
import ContinueWatching from '@/components/home/continue-watching';

export default function Home() {
  const firestore = useFirestore();
  const { user } = useUser();

  const fieldsQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'fields') : null), [firestore]);
  const { data: fields, isLoading: fieldsLoading } = useCollection<Field>(fieldsQuery);

  const classificationsQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'classifications') : null), [firestore]);
  const { data: classifications, isLoading: classificationsLoading } = useCollection<Classification>(classificationsQuery);
  
  const heroImagesRef = useMemoFirebase(() => (firestore ? doc(firestore, 'settings', 'heroImages') : null), [firestore]);
  const { data: heroImagesData, isLoading: heroImagesLoading } = useDoc<HeroImageSettings>(heroImagesRef);

  const isLoading = fieldsLoading || classificationsLoading || heroImagesLoading;
  
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
      <div className="container mx-auto space-y-16 py-12">
        {user && (
          <section>
            <h2 className="mb-6 font-headline text-3xl font-bold tracking-tight">
              시청기록
            </h2>
            <ContinueWatching />
          </section>
        )}
        {fields?.map((field) => {
          const classificationsInField = classifications?.filter(
            (c) => c.fieldId === field.id
          );
          
          if (!classificationsInField || classificationsInField.length === 0) return null;

          return (
            <section key={field.id}>
              <h2 className="mb-6 font-headline text-3xl font-bold tracking-tight">{field.name}</h2>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                {classificationsInField.map((classification) => (
                  <ClassificationCard key={classification.id} classification={classification} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
