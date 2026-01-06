
import Image from 'next/image';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import type { Episode } from '@/lib/types';
import { ImageIcon } from 'lucide-react';

interface EpisodeCardProps {
  episode: Episode;
}

export default function EpisodeCard({ episode }: EpisodeCardProps) {
  return (
    <Link href={`/courses/${episode.courseId}?episode=${episode.id}`} className="block h-full">
      <Card className="h-full overflow-hidden transition-all duration-300 hover:shadow-lg hover:border-primary/50">
        <div className="aspect-video overflow-hidden relative">
          {episode.thumbnailUrl ? (
            <Image
              src={episode.thumbnailUrl}
              alt={episode.title}
              width={600}
              height={400}
              className="h-full w-full object-cover transition-transform duration-300 hover:scale-105"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-muted">
              <ImageIcon className="h-10 w-10 text-muted-foreground" />
            </div>
          )}
        </div>
        <CardHeader className="p-3">
          <CardTitle className="font-headline text-sm leading-snug tracking-tight line-clamp-2 h-[2.5em]">
            {episode.title}
          </CardTitle>
        </CardHeader>
      </Card>
    </Link>
  );
}
