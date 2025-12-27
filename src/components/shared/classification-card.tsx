import Image from 'next/image';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { Classification } from '@/lib/types';

interface ClassificationCardProps {
  classification: Classification;
}

export default function ClassificationCard({ classification }: ClassificationCardProps) {
  return (
    <Link href={`/classifications/${classification.id}`} className="block h-full group">
      <Card className="h-full overflow-hidden transition-all duration-300 hover:shadow-xl hover:border-primary/50">
        <div className="aspect-video overflow-hidden relative">
          <Image
            src={classification.thumbnailUrl || 'https://picsum.photos/seed/placeholder/600/400'}
            alt={classification.name}
            fill
            sizes="(max-width: 768px) 50vw, (max-width: 1200px) 33vw, 25vw"
            className="object-cover transition-transform duration-300 group-hover:scale-105"
          />
        </div>
        <CardHeader>
          <CardTitle className="font-headline text-xl tracking-tight truncate group-hover:text-primary">
            {classification.name}
          </CardTitle>
        </CardHeader>
      </Card>
    </Link>
  );
}
