'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from '@/components/ui/dialog';
import type { Episode, Instructor, ChatMessage, ChatLog, User } from '@/lib/types';
import { useEffect, useRef, useState, useTransition } from 'react';
import { Button } from '../ui/button';
import { useUser, useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { logEpisodeView } from '@/lib/actions/log-view';
import { Textarea } from '../ui/textarea';
import { Send, Sparkles, Bot, User as UserIcon } from 'lucide-react';
import { ScrollArea } from '../ui/scroll-area';
import { askVideoTutor } from '@/ai/flows/video-tutor-flow';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { v4 as uuidv4 } from 'uuid';
import { collection, query, where, orderBy } from 'firebase/firestore';
import { toDisplayDateTime } from '@/lib/date-helpers';
import { Skeleton } from '../ui/skeleton';

interface VideoPlayerDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  episode: Episode;
  instructor: Instructor | null;
}

const SummaryView = ({ episode }: { episode: Episode }) => {
    const isAIAvailable = episode.aiProcessingStatus === 'completed' && episode.aiGeneratedContent;

    if (!isAIAvailable) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground p-4">
                <Sparkles className="h-10 w-10 mb-4" />
                <p className="text-sm font-semibold">
                    {episode.aiProcessingStatus === 'pending' || episode.aiProcessingStatus === 'processing'
                        ? 'AI 요약을 생성하는 중입니다.'
                        : '아직 이 영상에 대한 AI 요약이 없습니다.'}
                </p>
                 <p className="text-xs text-muted-foreground mt-1">잠시 후 다시 시도해주세요.</p>
            </div>
        );
    }

    return (
        <ScrollArea className="h-full">
            <div className="p-4 bg-muted/50 rounded-md">
                <h4 className="font-semibold mb-2 text-primary">AI 생성 강의 요약</h4>
                <p className="text-sm whitespace-pre-wrap font-body leading-relaxed">
                    {episode.aiGeneratedContent}
                </p>
            </div>
        </ScrollArea>
    );
};


export default function VideoPlayerDialog({ isOpen, onOpenChange, episode, instructor }: VideoPlayerDialogProps) {
  const { user } = useUser();
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [userQuestion, setUserQuestion] = useState('');
  const [activeView, setActiveView] = useState<'summary' | 'chat'>('summary');
  const chatScrollAreaRef = useRef<HTMLDivElement>(null);


  const videoKey = episode.id; 

  const handleClose = () => {
    const videoElement = document.getElementById(`video-${videoKey}`) as HTMLVideoElement;
    if (videoElement) {
        videoElement.pause();
        videoElement.src = ''; 
    }
    onOpenChange(false);
    setChatMessages([]);
    setUserQuestion('');
    setActiveView('summary');
  }
  
  useEffect(() => {
    let startTime: Date | null = null;
    if (isOpen && user) {
        startTime = new Date();
    }
    
    return () => {
        if (user && startTime) {
            const endTime = new Date();
            const durationWatched = (endTime.getTime() - startTime.getTime()) / 1000;

            if (durationWatched > 1) { // 1초 이상 시청한 경우에만 기록
                const payload = {
                    userId: user.id,
                    userName: user.name,
                    userEmail: user.email,
                    episodeId: episode.id,
                    episodeTitle: episode.title,
                    courseId: episode.courseId,
                    startedAt: startTime,
                    endedAt: endTime,
                };
                logEpisodeView(payload);
            }
        }
    };
  }, [isOpen, user, episode.id, episode.title, episode.courseId]);
  
  useEffect(() => {
    // Scroll to bottom when new messages are added
    if (activeView === 'chat' && chatScrollAreaRef.current) {
        chatScrollAreaRef.current.scrollTo({ top: chatScrollAreaRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [chatMessages, activeView]);

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

  const isAIAvailable = episode.aiProcessingStatus === 'completed';

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) handleClose(); }}>
      <DialogContent className="max-w-4xl p-0 border-0 flex flex-col h-[90vh]">
         
        <div className="aspect-video w-full bg-black flex-shrink-0">
          <video
            id={`video-${videoKey}`}
            key={videoKey}
            controls
            autoPlay
            className="w-full h-full"
            poster={episode.thumbnailUrl}
            crossOrigin="anonymous"
          >
            <source src={episode.videoUrl} type="video/mp4" />
            {episode.vttUrl && (
                <track 
                    src={episode.vttUrl} 
                    kind="subtitles" 
                    srcLang="ko" 
                    label="한국어" 
                    default 
                />
            )}
            브라우저가 비디오 태그를 지원하지 않습니다.
          </video>
        </div>
        <DialogHeader className="px-4 py-0 border-b flex-shrink-0">
            <div className="flex justify-between items-center py-1">
                <DialogTitle className="text-base font-bold truncate pr-4">{episode.title}</DialogTitle>
                <div className="flex items-center gap-1 rounded-md bg-muted p-1">
                    <Button variant={activeView === 'summary' ? 'secondary' : 'ghost'} size="sm" className="h-7 px-2 text-xs" onClick={() => setActiveView('summary')}>
                        <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                        강의 요약
                    </Button>
                    <Button variant={activeView === 'chat' ? 'secondary' : 'ghost'} size="sm" className="h-7 px-2 text-xs" onClick={() => setActiveView('chat')}>
                        <Bot className="mr-1.5 h-3.5 w-3.5" />
                        AI 채팅
                    </Button>
                </div>
            </div>
        </DialogHeader>
        
         <div className="flex-grow p-4 pt-2 flex flex-col gap-4 min-h-0">
            {activeView === 'summary' && (
                <SummaryView episode={episode} />
            )}
            {activeView === 'chat' && (
                <>
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
                    <div className="flex-shrink-0 flex gap-2 items-center">
                        <Textarea 
                            placeholder={!isAIAvailable ? "AI 분석이 아직 완료되지 않았습니다." : "AI에게 질문할 내용을 입력하세요..."}
                            className="flex-grow resize-none h-10 min-h-0" 
                            rows={1}
                            value={userQuestion}
                            onChange={(e) => setUserQuestion(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    handleAskQuestion();
                                }
                            }}
                            disabled={isPending || !isAIAvailable}
                        />
                        <Button onClick={handleAskQuestion} disabled={isPending || !userQuestion.trim() || !isAIAvailable}>
                            <Send className="h-4 w-4" />
                        </Button>
                    </div>
                </>
            )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
