'use client';

import { useLandingPage } from '@/context/landing-page-context';
import OriginalHome from '@/components/landing/OriginalHome';
import AboutHome from '@/components/landing/AboutHome';
import { Skeleton } from '@/components/ui/skeleton';

export default function AboutPage() {
    const { preference, isLandingPageLoading } = useLandingPage();

    if (isLandingPageLoading) {
        return (
            <div className="container mx-auto flex h-[80vh] items-center justify-center">
                <Skeleton className="h-64 w-full" />
            </div>
        );
    }
    
    // In App version ('original'), the main page is the app, so /about shows the intro.
    if (preference === 'original') {
        return <AboutHome />;
    }

    // In Homepage version ('about'), the main page is the intro, so /about shows the app.
    return <OriginalHome />;
}
