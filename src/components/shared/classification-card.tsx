import Image from 'next/image';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { Classification } from '@/lib/types';
import { ArrowRight } from 'lucide-react';

interface ClassificationCardProps {
  classification: Classification;
}

export default function ClassificationCard({ classification }: ClassificationCardProps) {
  return (
    <Link href={`/classifications/${classification.id}`} className="block h-full group">
      <Card className="h-full overflow-hidden transition-all duration-300 hover:shadow-2xl hover:-translate-y-2 bg-gradient-to-br from-card to-muted/50">
        <div className="aspect-[4/3] overflow-hidden relative">
          <Image
            src={classification.thumbnailUrl || 'https://picsum.photos/seed/placeholder/600/400'}
            alt={classification.name}
            fill
            sizes="(max-width: 768px) 50vw, (max-width: 1200px) 33vw, 25vw"
            className="object-cover transition-transform duration-500 ease-in-out group-hover:scale-105"
          />
           <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
        </div>
        <CardHeader className="absolute bottom-0 left-0 right-0 p-4 bg-transparent">
          <CardTitle className="font-headline text-lg tracking-tight text-white group-hover:text-accent">
            {classification.name}
          </CardTitle>
          <div className="flex items-center text-xs text-white/80 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
            <span>자세히 보기</span>
            <ArrowRight className="ml-1 h-3 w-3" />
          </div>
        </CardHeader>
      </Card>
    </Link>
  );
}
