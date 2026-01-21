
'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { Episode, Instructor, ChatMessage } from '@/lib/types';
import { useEffect, useRef, useState, useTransition } from 'react';
import { Button } from '../ui/button';
import { useUser } from '@/firebase';
import { logEpisodeView } from '@/lib/actions/log-view';
import { Textarea } from '../ui/textarea';
import { Send, Sparkles, Bot, User as UserIcon, X, Loader } from 'lucide-react';
import { ScrollArea } from '../ui/scroll-area';
import { askVideoTutor } from '@/ai/flows/video-tutor-flow';
import { cn } from '@/lib/utils';
import { v4 as uuidv4 } from 'uuid';
import { getSignedUrl } from '@/lib/actions/get-signed-url';

interface VideoPlayerDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  episode: Episode;
  instructor: Instructor | null;
}

const ChatView = ({ episode, user }: { episode: Episode, user: any }) => {
    const [isPending, startTransition] = useTransition();
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
    const [userQuestion, setUserQuestion] = useState('');
    const chatScrollAreaRef = useRef<HTMLDivElement>(null);
    const isAIAvailable = episode.aiProcessingStatus === 'completed';

    useEffect(() => {
        if (chatScrollAreaRef.current) {
            chatScrollAreaRef.current.scrollTo({ top: chatScrollAreaRef.current.scrollHeight, behavior: 'smooth' });
        }
    }, [chatMessages]);

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
                    userId: user.id,
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
        <>
            <ScrollArea className="flex-grow bg-muted rounded-md p-4" viewportRef={chatScrollAreaRef}>
                {chatMessages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center">
                    <Bot className="h-12 w-12 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground mt-2">
                        AI 튜터에게 비디오 내용에 대해 궁금한 점을 검색해보세요.
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
             <div className="flex-shrink-0 pt-4">
                <div className="flex gap-2 items-center">
                    <Textarea 
                        placeholder={!isAIAvailable ? "AI 분석이 아직 완료되지 않았습니다." : "AI에게 검색할 내용을 입력하세요..."}
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
            </div>
        </>
    );
};


export default function VideoPlayerDialog({ isOpen, onOpenChange, episode, instructor }: VideoPlayerDialogProps) {
  const { user } = useUser();
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [vttSrc, setVttSrc] = useState<string | null>(null);
  const [isLoadingSrc, setIsLoadingSrc] = useState(true);
  const [srcError, setSrcError] = useState<string | null>(null);
  const videoKey = episode.id; 
  const startTimeRef = useRef<Date | null>(null);

  const handleClose = () => {
    const videoElement = document.getElementById(`video-${videoKey}`) as HTMLVideoElement;
    if (videoElement) {
        videoElement.pause();
        videoElement.removeAttribute('src'); 
        videoElement.load();
    }
    
    if (user && startTimeRef.current) {
        const endTime = new Date();
        const durationWatched = (endTime.getTime() - startTimeRef.current.getTime()) / 1000;

        if (durationWatched > 1) {
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
            logEpisodeView(payload);
        }
    }
    
    onOpenChange(false);
    setVideoSrc(null);
    setVttSrc(null);
    setIsLoadingSrc(true);
    setSrcError(null);
    startTimeRef.current = null;
  }
  
  useEffect(() => {
    if (isOpen) {
        startTimeRef.current = new Date();

        setIsLoadingSrc(true);
        setSrcError(null);
        setVideoSrc(null);
        setVttSrc(null);

        if (episode.filePath) {
            getSignedUrl(episode.filePath)
                .then(result => {
                    if ('signedURL' in result) {
                        setVideoSrc(result.signedURL);
                    } else {
                        setSrcError(result.error);
                    }
                })
                .catch(err => {
                    console.error("Failed to get video signed URL:", err);
                    setSrcError('비디오 주소를 가져오는 데 실패했습니다.');
                })
                .finally(() => {
                    if (!episode.vttPath) {
                        setIsLoadingSrc(false);
                    }
                });
        } else {
             setSrcError('비디오 파일 경로를 찾을 수 없습니다.');
             setIsLoadingSrc(false);
        }
        
        if (episode.vttPath) {
            getSignedUrl(episode.vttPath)
                .then(result => {
                    if ('signedURL' in result) {
                        setVttSrc(result.signedURL);
                    }
                })
                .catch(err => {
                     console.warn("Failed to get VTT signed URL:", err);
                })
                .finally(() => {
                    setIsLoadingSrc(false);
                });
        }
    }
    
    return () => {
        // Cleanup function handles logging when dialog is unmounted while open
        if (isOpen) {
            handleClose();
        }
    };
  }, [isOpen, episode.id, episode.filePath, episode.vttPath]);
  
  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) handleClose(); }}>
      <DialogContent className="w-full h-full p-0 flex flex-col top-0 translate-y-0 rounded-none md:max-w-7xl md:h-[90vh] md:rounded-lg md:top-1/2 md:-translate-y-1/2">
        <DialogHeader className="p-4 border-b flex-shrink-0 bg-background z-10 hidden md:flex flex-row justify-between items-center">
            <DialogTitle className="text-lg font-bold truncate pr-4">{episode.title}</DialogTitle>
            <DialogDescription className="sr-only">
              {instructor?.name} 강사의 {episode.title} 비디오 플레이어.
            </DialogDescription>
            <button onClick={handleClose} className="rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
                <X className="h-4 w-4" />
                <span className="sr-only">Close</span>
            </button>
        </DialogHeader>

        <div className="flex-grow flex flex-col md:grid md:grid-cols-3 min-h-0">
            
            <div className="w-full aspect-video bg-black md:col-span-2 md:h-full flex flex-col">
                <div className="w-full flex-grow relative">
                    <div className="absolute top-0 left-0 right-0 z-20 p-4 bg-gradient-to-b from-black/50 to-transparent pointer-events-none md:hidden">
                        <DialogTitle className="text-white text-lg font-bold truncate pr-8">
                            {episode.title}
                        </DialogTitle>
                    </div>

                    <div className="absolute inset-0 flex items-center justify-center">
                        {isLoadingSrc && <Loader className="h-12 w-12 text-white animate-spin" />}
                        {srcError && !isLoadingSrc && (
                            <div className="text-white bg-red-900/80 p-4 rounded-lg text-center">
                                <p className="font-semibold">비디오를 불러올 수 없습니다</p>
                                <p className="text-sm mt-1">{srcError}</p>
                            </div>
                        )}
                    </div>
                    
                    {videoSrc && !isLoadingSrc && !srcError && (
                        <video
                            id={`video-${videoKey}`}
                            key={videoSrc}
                            controls
                            controlsList="nodownload"
                            onContextMenu={(e) => e.preventDefault()}
                            autoPlay
                            className="w-full h-full object-contain z-10 relative"
                            poster={episode.thumbnailUrl}
                            crossOrigin="anonymous"
                        >
                            <source src={videoSrc} type="video/mp4" />
                            {vttSrc && (
                                <track 
                                    src={vttSrc} 
                                    kind="subtitles" 
                                    srcLang="ko" 
                                    label="한국어" 
                                    default 
                                />
                            )}
                            브라우저가 비디오 태그를 지원하지 않습니다.
                        </video>
                    )}
                </div>
            </div>
            
            <div className="flex-grow flex flex-col md:col-span-1 border-l min-h-0 md:h-full">
                <div className="flex items-center justify-between p-2 border-b flex-shrink-0">
                    <h4 className="font-semibold truncate text-base pr-2">AI 튜터</h4>
                </div>
                <div className="flex-grow p-4 pt-2 flex flex-col gap-4 min-h-0">
                    {user && <ChatView episode={episode} user={user} />}
                </div>
            </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
