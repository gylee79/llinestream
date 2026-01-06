import Image from 'next/image';
import Link from 'next/link';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import type { Classification } from '@/lib/types';
import { ArrowRight } from 'lucide-react';

interface ClassificationCardProps {
  classification: Classification;
}

export default function ClassificationCard({ classification }: ClassificationCardProps) {
  return (
    <Link href={`/classifications/${classification.id}`} className="block h-full group">
      <Card className="relative h-full overflow-hidden transition-all duration-300 hover:shadow-2xl hover:-translate-y-2 bg-card">
        <div className="relative aspect-[4/3] overflow-hidden">
          <Image
            src={classification.thumbnailUrl || 'https://picsum.photos/seed/placeholder/600/400'}
            alt={classification.name}
            fill
            sizes="(max-width: 768px) 50vw, (max-width: 1200px) 33vw, 25vw"
            className="object-cover transition-transform duration-500 ease-in-out group-hover:scale-105"
          />
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />
        <CardHeader className="absolute bottom-0 left-0 right-0 p-4 z-10">
          <CardTitle className="font-headline text-base md:text-lg tracking-tight text-white">
            {classification.name}
          </CardTitle>
          <div className="flex items-center text-xs text-white/80 transition-opacity duration-300 opacity-0 group-hover:opacity-100">
            <span>자세히 보기</span>
            <ArrowRight className="ml-1 h-3 w-3" />
          </div>
        </CardHeader>
      </Card>
    </Link>
  );
}
