
'use client';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useDoc, useFirestore, useMemoFirebase } from '@/firebase';
import { doc } from 'firebase/firestore';
import type { Policy } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';

interface PolicyPageProps {
  params: { slug: string };
}

export default function PolicyPage({ params }: PolicyPageProps) {
  const firestore = useFirestore();
  const policyRef = useMemoFirebase(() => (firestore ? doc(firestore, 'policies', params.slug) : null), [firestore, params.slug]);
  const { data: policy, isLoading } = useDoc<Policy>(policyRef);

  if (isLoading) {
    return (
      <div className="container mx-auto max-w-4xl py-12">
        <Card>
          <CardHeader>
            <Skeleton className="h-10 w-3/4" />
          </CardHeader>
          <CardContent className="space-y-4">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
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
