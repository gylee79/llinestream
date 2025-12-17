import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getPolicyBySlug } from '@/lib/policies';

interface PolicyPageProps {
  params: Promise<{ slug: string }>;
}

export default async function PolicyPage({ params }: PolicyPageProps) {
  const { slug } = await params;
  const policy = await getPolicyBySlug(slug);

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
