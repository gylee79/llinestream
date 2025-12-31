
'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { Episode, Instructor } from '@/lib/types';
import { useEffect, useRef } from 'react';
import { Button } from '../ui/button';
import { useUser } from '@/firebase';
import { logEpisodeView } from '@/lib/actions/log-view';
import { Textarea } from '../ui/textarea';
import { Send } from 'lucide-react';
import { ScrollArea } from '../ui/scroll-area';

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
      <DialogContent className="max-w-4xl p-0 border-0 flex flex-col h-[90vh]">
        <div className="aspect-video w-full bg-black flex-shrink-0">
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
        <DialogHeader className="p-4 border-b flex-shrink-0">
          <div className="flex justify-between items-center">
            <div>
              <DialogTitle>{episode.title}</DialogTitle>
              {instructor && <p className="text-sm text-muted-foreground mt-1">강사: {instructor.name}</p>}
            </div>
            <Button variant="outline" onClick={handleClose}>나가기</Button>
          </div>
        </DialogHeader>
        <div className="flex-grow p-4 flex flex-col gap-4 min-h-0">
          <p className="text-sm font-semibold flex-shrink-0">AI에게 질문하기</p>
          <ScrollArea className="flex-grow bg-muted rounded-md p-4">
            {/* AI Chat messages will go here */}
            <p className="text-sm text-muted-foreground text-center">AI에게 궁금한 점을 물어보세요.</p>
          </ScrollArea>
          <div className="flex gap-2 flex-shrink-0">
            <Textarea placeholder="AI에게 질문할 내용을 입력하세요..." className="flex-grow resize-none" rows={1} />
            <Button>
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
