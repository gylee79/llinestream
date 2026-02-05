
import Image from 'next/image';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import type { Episode } from '@/lib/types';
import { ImageIcon } from 'lucide-react';

interface EpisodeCardProps {
  episode: Episode;
  index?: number;
}

export default function EpisodeCard({ episode, index }: EpisodeCardProps) {
  return (
    <Link href={`/courses/${episode.courseId}?episode=${episode.id}`} className="block h-full">
      <Card className="h-full overflow-hidden transition-all duration-300 hover:shadow-lg bg-transparent border-none shadow-none rounded-lg">
        <div className="aspect-video overflow-hidden relative rounded-lg">
          {episode.thumbnailUrl ? (
            <Image
              src={episode.thumbnailUrl}
              alt={episode.title}
              width={600}
              height={400}
              className="h-full w-full object-cover transition-transform duration-300 hover:scale-105"
              priority={index !== undefined && index < 4}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-muted rounded-lg">
              <ImageIcon className="h-10 w-10 text-muted-foreground" />
            </div>
          )}
        </div>
        <CardHeader className="p-2">
          <CardTitle className="font-headline text-sm leading-snug tracking-tight line-clamp-2 h-[2.5em]">
            {episode.title}
          </CardTitle>
        </CardHeader>
      </Card>
    </Link>
  );
}
