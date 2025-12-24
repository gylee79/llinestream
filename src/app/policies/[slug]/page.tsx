
'use client';

import { useParams, notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useDoc, useFirestore, useMemoFirebase } from '@/firebase';
import { doc } from 'firebase/firestore';
import type { Policy } from '@/lib/types';

export default function PolicyPage() {
  const params = useParams<{ slug: string }>();
  const firestore = useFirestore();
  const slug = params.slug;

  const policyRef = useMemoFirebase(
    () => (firestore && slug ? doc(firestore, 'policies', slug) : null),
    [firestore, slug]
  );

  const { data: policy, isLoading } = useDoc<Policy>(policyRef);

  if (isLoading) {
    return (
      <div className="container mx-auto max-w-4xl py-12">
        <Card>
          <CardHeader>
            <Skeleton className="h-9 w-1/2" />
          </CardHeader>
          <CardContent className="space-y-4">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!policy) {
    notFound();
  }

  return (
    <div className="container mx-auto max-w-4xl py-12">
      <Card>
        <CardHeader>
          <CardTitle className="font-headline text-3xl">{policy.title}</CardTitle>
        </CardHeader>
        <CardContent>
          <div
            className="prose dark:prose-invert max-w-none"
            dangerouslySetInnerHTML={{ __html: policy.content.replace(/\n/g, '<br />') }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
