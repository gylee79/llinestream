
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
import { Send, Sparkles, Bot, User as UserIcon, History, X } from 'lucide-react';
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

const ChatHistory = ({ episode, user }: { episode: Episode, user: User | null }) => {
    const firestore = useFirestore();
    const chatHistoryQuery = useMemoFirebase(() => {
        if (!firestore || !user) return null;
        return query(
            collection(firestore, 'users', user.id, 'chats'),
            where('episodeId', '==', episode.id),
            orderBy('createdAt', 'desc')
        );
    }, [firestore, user, episode.id]);
    
    const { data: pastChats, isLoading } = useCollection<ChatLog>(chatHistoryQuery);

    if (isLoading) {
        return (
            <div className="space-y-4 p-4">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
            </div>
        );
    }
    
    if (!pastChats || pastChats.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground p-4">
                <History className="h-10 w-10 mb-2" />
                <p className="text-sm">이 에피소드에 대한 채팅 기록이 없습니다.</p>
            </div>
        );
    }
    
    return (
        <ScrollArea className="h-full">
            <div className="space-y-4 p-4">
                {pastChats.map(log => (
                    <div key={log.id} className="text-xs border-b pb-2">
                        <p className="font-semibold text-primary mb-1">Q: {log.question}</p>
                        <p className="text-muted-foreground mb-2">A: {log.answer}</p>
                        <p className="text-right text-muted-foreground/80">{toDisplayDateTime(log.createdAt)}</p>
                    </div>
                ))}
            </div>
        </ScrollArea>
    );
};


export default function VideoPlayerDialog({ isOpen, onOpenChange, episode, instructor }: VideoPlayerDialogProps) {
  const { user } = useUser();
  const { toast } = useToast();
  const startTimeRef = useRef<Date | null>(null);
  const [isPending, startTransition] = useTransition();

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [userQuestion, setUserQuestion] = useState('');
  const [activeView, setActiveView] = useState<'chat' | 'history'>('chat');
  const chatScrollAreaRef = useRef<HTMLDivElement>(null);


  // This key forces remounting of the video element when the episode changes
  const videoKey = episode.id; 

  const handleClose = async () => {
    const videoElement = document.getElementById(`video-${videoKey}`) as HTMLVideoElement;
    if (videoElement) {
        videoElement.pause();
        videoElement.src = ''; // This forces the browser to stop downloading/buffering
    }

    if (user && startTimeRef.current) {
        const endTime = new Date();
        const durationWatched = (endTime.getTime() - startTimeRef.current.getTime()) / 1000; // in seconds
        
        if (durationWatched > 1) { // Only log if watched for more than 1 second
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
        }
        startTimeRef.current = null; // Reset start time
    }
    onOpenChange(false);
    // Reset state for next time
    setChatMessages([]);
    setUserQuestion('');
    setActiveView('chat');
  }
  
  useEffect(() => {
    if (isOpen && user) {
        startTimeRef.current = new Date();
    }
  }, [isOpen, user]);
  
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

  const isAIAvailable = episode.transcript !== undefined && episode.transcript !== null;

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
        <DialogHeader className="px-4 border-b flex-shrink-0">
            <div className="flex justify-between items-center">
                <DialogTitle className="text-base font-bold truncate pr-4">{activeView === 'chat' ? episode.title : '과거 채팅 기록'}</DialogTitle>
                <div className="flex flex-col items-end flex-shrink-0">
                    {instructor && <p className="text-xs text-muted-foreground">강사: {instructor.name}</p>}
                     <Button 
                        variant="outline" 
                        size="sm" 
                        className="h-7" 
                        onClick={() => setActiveView(prev => prev === 'chat' ? 'history' : 'chat')}
                     >
                        <History className="h-3 w-3 mr-1.5" />
                        {activeView === 'chat' ? '기록 보기' : '채팅 하기'}
                    </Button>
                </div>
            </div>
        </DialogHeader>
        
         <div className="flex-grow p-4 pt-2 flex flex-col gap-4 min-h-0">
            {activeView === 'chat' ? (
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
            ) : (
                <ChatHistory episode={episode} user={user} />
            )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

    
