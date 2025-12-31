
'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { Episode, Instructor, ChatMessage } from '@/lib/types';
import { useEffect, useRef, useState, useTransition } from 'react';
import { Button } from '../ui/button';
import { useUser } from '@/firebase';
import { logEpisodeView } from '@/lib/actions/log-view';
import { Textarea } from '../ui/textarea';
import { Send, Sparkles, Bot, User as UserIcon } from 'lucide-react';
import { ScrollArea } from '../ui/scroll-area';
import { processVideoForAI } from '@/lib/actions/process-video';
import { askVideoTutor } from '@/ai/flows/video-tutor-flow';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { v4 as uuidv4 } from 'uuid';

interface VideoPlayerDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  episode: Episode;
  instructor: Instructor | null;
}

export default function VideoPlayerDialog({ isOpen, onOpenChange, episode, instructor }: VideoPlayerDialogProps) {
  const { user } = useUser();
  const startTimeRef = useRef<Date | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [userQuestion, setUserQuestion] = useState('');
  const chatScrollAreaRef = useRef<HTMLDivElement>(null);


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
    setChatMessages([]);
    setUserQuestion('');
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
  
  useEffect(() => {
    // Scroll to bottom when new messages are added
    if (chatScrollAreaRef.current) {
        chatScrollAreaRef.current.scrollTo({ top: chatScrollAreaRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [chatMessages]);

  const handleProcessVideo = async () => {
    setIsProcessing(true);
    const { id: toastId } = toast({
      title: 'AI 분석 시작',
      description: '비디오 분석을 시작합니다. 잠시 후 질문 기능이 활성화됩니다.',
    });
    
    const result = await processVideoForAI(episode.id);

    toast({
      id: toastId,
      title: result.success ? '분석 완료' : '분석 실패',
      description: result.message,
      variant: result.success ? 'default' : 'destructive',
    });
    setIsProcessing(false);
  };

  const handleAskQuestion = () => {
    if (!userQuestion.trim() || !user) return;

    const newQuestion: ChatMessage = {
      id: uuidv4(),
      role: 'user',
      content: userQuestion.trim(),
      createdAt: new Date(),
    };

    setChatMessages(prev => [...prev, newQuestion]);
    setUserQuestion('');

    startTransition(async () => {
        try {
            const result = await askVideoTutor({
                episodeId: episode.id,
                question: newQuestion.content,
                userId: user.id
            });
            const newAnswer: ChatMessage = {
                id: uuidv4(),
                role: 'model',
                content: result.answer,
                createdAt: new Date(),
            };
            setChatMessages(prev => [...prev, newAnswer]);
        } catch (error) {
            console.error("Error asking video tutor:", error);
            const errorAnswer: ChatMessage = {
                id: uuidv4(),
                role: 'model',
                content: "죄송합니다, 답변을 생성하는 중에 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
                createdAt: new Date(),
            };
            setChatMessages(prev => [...prev, errorAnswer]);
        }
    });
  }

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
            <div className="flex items-center gap-2">
              {user?.role === 'admin' && episode.transcript === undefined && (
                <Button variant="outline" size="sm" onClick={handleProcessVideo} disabled={isProcessing}>
                  <Sparkles className="mr-2 h-4 w-4" />
                  {isProcessing ? 'AI 분석 중...' : 'AI 분석 실행'}
                </Button>
              )}
              <Button variant="outline" onClick={handleClose}>나가기</Button>
            </div>
          </div>
        </DialogHeader>
        <div className="flex-grow p-4 flex flex-col gap-4 min-h-0">
          <p className="text-sm font-semibold flex-shrink-0">AI에게 질문하기</p>
          <ScrollArea className="flex-grow bg-muted rounded-md p-4" viewportRef={chatScrollAreaRef}>
            {chatMessages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <Bot className="h-12 w-12 text-muted-foreground" />
                <p className="text-sm text-muted-foreground mt-2">
                    AI 튜터에게 비디오 내용에 대해 궁금한 점을 물어보세요.
                </p>
              </div>
            ) : (
                <div className="space-y-4">
                    {chatMessages.map(message => (
                        <div key={message.id} className={cn("flex items-start gap-3", message.role === 'user' ? 'justify-end' : 'justify-start')}>
                            {message.role === 'model' && (
                                <div className="flex-shrink-0 h-8 w-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
                                    <Bot className="h-5 w-5" />
                                </div>
                            )}
                             <div className={cn(
                                "max-w-md p-3 rounded-lg",
                                message.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-background border'
                            )}>
                                <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                            </div>
                             {message.role === 'user' && (
                                <div className="flex-shrink-0 h-8 w-8 rounded-full bg-secondary text-secondary-foreground flex items-center justify-center">
                                    <UserIcon className="h-5 w-5" />
                                </div>
                            )}
                        </div>
                    ))}
                    {isPending && (
                        <div className="flex items-start gap-3 justify-start">
                            <div className="flex-shrink-0 h-8 w-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
                                <Bot className="h-5 w-5 animate-spin" />
                            </div>
                            <div className="max-w-md p-3 rounded-lg bg-background border">
                                <p className="text-sm text-muted-foreground">답변을 생각하고 있어요...</p>
                            </div>
                        </div>
                    )}
                </div>
            )}
          </ScrollArea>
          <div className="flex gap-2 flex-shrink-0">
            <Textarea 
                placeholder="AI에게 질문할 내용을 입력하세요..." 
                className="flex-grow resize-none" 
                rows={1}
                value={userQuestion}
                onChange={(e) => setUserQuestion(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleAskQuestion();
                    }
                }}
                disabled={isPending || (episode.transcript === undefined && user?.role !== 'admin')}
            />
            <Button onClick={handleAskQuestion} disabled={isPending || !userQuestion.trim() || (episode.transcript === undefined && user?.role !== 'admin')}>
              <Send className="h-4 w-4" />
            </Button>
          </div>
          {episode.transcript === undefined && user?.role !== 'admin' && (
            <p className="text-xs text-center text-muted-foreground">
              이 영상은 아직 AI 질문 기능이 활성화되지 않았습니다.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
