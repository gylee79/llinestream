
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getPolicyBySlug } from '@/lib/policies';
import type { Policy } from '@/lib/types';

interface PolicyPageProps {
  params: {
    slug: string;
  };
}

// This is now a React Server Component. It fetches data on the server.
export default async function PolicyPage({ params }: PolicyPageProps) {
  const { slug } = params;
  const policy = await getPolicyBySlug(slug);

  // If no policy is found for the given slug, render a 404 page.
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

// This function tells Next.js which slugs are available and should be pre-rendered at build time.
export function generateStaticParams() {
  return [
    { slug: 'terms' },
    { slug: 'privacy' },
    { slug: 'refund' },
  ];
}
