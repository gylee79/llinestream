
'use client';

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose
} from '@/components/ui/dialog';
import type { Episode, Instructor, User } from '@/lib/types';
import { useEffect, useRef } from 'react';
import { Button } from '../ui/button';
import { useUser } from '@/firebase';
import { logEpisodeView } from '@/lib/actions/log-view';

interface VideoPlayerDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  episode: Episode;
  instructor: Instructor | null;
}

export default function VideoPlayerDialog({ isOpen, onOpenChange, episode, instructor }: VideoPlayerDialogProps) {
  const { user } = useUser();
  const startTimeRef = useRef<Date | null>(null);

  // This key forces remounting of the video element when the episode changes
  const videoKey = episode.id; 

  const handleClose = async () => {
    if (user && startTimeRef.current) {
        const endTime = new Date();
        const payload = {
            userId: user.id,
            userName: user.name,
            userEmail: user.email,
            episodeId: episode.id,
            episodeTitle: episode.title,
            courseId: episode.courseId,
            startedAt: startTimeRef.current,
            endedAt: endTime,
        };
        await logEpisodeView(payload);
        startTimeRef.current = null; // Reset start time
    }
    onOpenChange(false);
  }
  
  useEffect(() => {
    if (isOpen && user) {
        startTimeRef.current = new Date();
    }
    
    // When the dialog closes, pause the video by removing the src
    // This is a simple way to stop playback and background loading
    return () => {
      const videoElement = document.getElementById(`video-${videoKey}`) as HTMLVideoElement;
      if (videoElement) {
        videoElement.pause();
        videoElement.src = '';
      }
    };
  }, [isOpen, videoKey, user]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => {
        if (!open) {
            handleClose();
        } else {
            onOpenChange(true);
        }
    }}>
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
           <Button variant="outline" onClick={handleClose}>나가기</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
