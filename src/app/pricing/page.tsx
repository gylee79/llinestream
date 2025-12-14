'use client';
import PricingCard from '@/components/pricing/pricing-card';
import { useCollection, useFirestore, useMemoFirebase } from '@/firebase';
import { collection, query, where } from 'firebase/firestore';
import type { Classification } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';

export default function PricingPage() {
  const firestore = useFirestore();
  const classificationsQuery = useMemoFirebase(() => 
    query(collection(firestore, 'classifications'), where('prices.day30', '>', 0)),
    [firestore]
  );
  const { data: subscribableClassifications, isLoading } = useCollection<Classification>(classificationsQuery);

  return (
    <div className="container mx-auto py-12">
      <header className="mb-12 text-center">
        <h1 className="font-headline text-4xl font-bold tracking-tight">요금제 안내</h1>
        <p className="mt-2 text-lg text-muted-foreground">
          관심 있는 분야를 구독하고 모든 콘텐츠를 무제한으로 즐겨보세요.
        </p>
      </header>
      <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
        {isLoading ? (
          <>
            <Skeleton className="h-96 w-full" />
            <Skeleton className="h-96 w-full" />
            <Skeleton className="h-96 w-full" />
          </>
        ) : (
          subscribableClassifications?.map((classification) => (
            <PricingCard key={classification.id} classification={classification} />
          ))
        )}
      </div>
    </div>
  );
}
