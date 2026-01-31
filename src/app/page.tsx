'use client';

import { useLandingPage } from '@/context/landing-page-context';
import OriginalHome from '@/components/landing/OriginalHome';
import AboutHome from '@/components/landing/AboutHome';
import { Skeleton } from '@/components/ui/skeleton';

export default function HomePage() {
  const { preference, isLandingPageLoading } = useLandingPage();

  if (isLandingPageLoading) {
    return (
      <div className="container py-8 space-y-8">
        <Skeleton className="h-[70vh] w-full rounded-lg" />
        <Skeleton className="h-8 w-1/3" />
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
        </div>
      </div>
    );
  }

  if (preference === 'original') {
    return <OriginalHome />;
  }

  return <AboutHome />;
}
