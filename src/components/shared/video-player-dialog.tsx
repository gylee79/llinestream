'use client';

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose
} from '@/components/ui/dialog';
import type { Episode, Instructor } from '@/lib/types';
import { useEffect } from 'react';
import { Button } from '../ui/button';

interface VideoPlayerDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  episode: Episode;
  instructor: Instructor | null;
}

export default function VideoPlayerDialog({ isOpen, onOpenChange, episode, instructor }: VideoPlayerDialogProps) {

  // This key forces remounting of the video element when the episode changes
  const videoKey = episode.id; 
  
  useEffect(() => {
    // When the dialog closes, pause the video by removing the src
    // This is a simple way to stop playback and background loading
    return () => {
      const videoElement = document.getElementById(`video-${videoKey}`) as HTMLVideoElement;
      if (videoElement) {
        videoElement.pause();
        videoElement.src = '';
      }
    };
  }, [isOpen, videoKey]);

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl p-0 border-0 flex flex-col">
        <div className="aspect-video w-full bg-black">
          <video
            id={`video-${videoKey}`}
            key={videoKey}
            controls
            autoPlay
            className="w-full h-full"
            poster={episode.thumbnailUrl}
          >
            <source src={episode.videoUrl} type="video/mp4" />
            브라우저가 비디오 태그를 지원하지 않습니다.
          </video>
        </div>
        <DialogHeader className="p-6 pt-2 pb-0">
          <DialogTitle>{episode.title}</DialogTitle>
        </DialogHeader>
        <DialogFooter className="p-6 pt-2 flex items-center justify-between">
           {instructor && <p className="text-sm text-muted-foreground">강사: {instructor.name}</p>}
          <DialogClose asChild>
            <Button variant="outline">나가기</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
