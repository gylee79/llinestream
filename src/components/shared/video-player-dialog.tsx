'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import type { Episode, Instructor, ChatMessage, ChatLog } from '@/lib/types';
import { useEffect, useRef, useState, useTransition, useCallback } from 'react';
import { Button } from '../ui/button';
import { useUser, useFirestore, useMemoFirebase } from '@/firebase';
import { logEpisodeView } from '@/lib/actions/log-view';
import { Textarea } from '../ui/textarea';
import { Send, Bot, User as UserIcon, X, Loader, FileText, Clock } from 'lucide-react';
import { ScrollArea } from '../ui/scroll-area';
import { askVideoTutor } from '@/ai/flows/video-tutor-flow';
import { cn } from '@/lib/utils';
import { v4 as uuidv4 } from 'uuid';
import { getSignedUrl } from '@/lib/actions/get-signed-url';
import { getVttContent } from '@/lib/actions/get-vtt-content';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../ui/accordion';
import { useIsMobile } from '@/hooks/use-mobile';
import { collection, query, where, orderBy, onSnapshot, Timestamp as FirebaseTimestamp } from 'firebase/firestore';
import { toJSDate } from '@/lib/date-helpers';
import React from 'react';

interface VideoPlayerDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  episode: Episode;
  instructor: Instructor | null;
  chatMessages?: ChatMessage[];
  setChatMessages?: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
}

const ChatView = ({ episode, user, chatMessages: propMessages, setChatMessages: propSetMessages }: { 
    episode: Episode, 
    user: any,
    chatMessages?: ChatMessage[];
    setChatMessages?: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
}) => {
    const firestore = useFirestore();
    const [isPending, startTransition] = useTransition();
    const [userQuestion, setUserQuestion] = useState('');
    const chatScrollAreaRef = useRef<HTMLDivElement>(null);
    
    // Internal state for chat messages if not provided by props
    const [internalMessages, setInternalMessages] = useState<ChatMessage[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    const messages = propMessages !== undefined ? propMessages : internalMessages;
    const setMessages = propSetMessages !== undefined ? propSetMessages : setInternalMessages;

    const isAIAvailable = episode.aiProcessingStatus === 'completed';

    useEffect(() => {
        if (!user || !firestore) {
            setIsLoading(false);
            setMessages([]);
            return;
        }
        
        // Query the global chat_logs collection using an existing index.
        const q = query(
            collection(firestore, 'chat_logs'), 
            where('userId', '==', user.id),
            where('episodeId', '==', episode.id), 
            orderBy('createdAt', 'desc')
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const logs = snapshot.docs.map(doc => doc.data() as ChatLog);
            // Reverse the logs to get chronological order (asc) for display.
            const reversedLogs = logs.reverse(); 

            const newMessages = reversedLogs.flatMap(log => {
                const logDate = (log.createdAt as FirebaseTimestamp)?.toDate() || new Date();
                const answerDate = new Date(logDate.getTime() + 1);
                return [
                    { id: `${log.id}-q`, role: 'user' as const, content: log.question, createdAt: logDate },
                    { id: `${log.id}-a`, role: 'model' as const, content: log.answer, createdAt: answerDate }
                ];
            });
            
            setMessages(newMessages);
            setIsLoading(false);
        }, (error) => {
            console.error("Error fetching chat history:", error);
            setIsLoading(false);
        });

        return () => unsubscribe();
    }, [user, episode.id, firestore, setMessages]);

    useEffect(() => {
        if (chatScrollAreaRef.current) {
            chatScrollAreaRef.current.scrollTo({ top: chatScrollAreaRef.current.scrollHeight, behavior: 'smooth' });
        }
    }, [messages, isPending]);

    const handleAskQuestion = () => {
        if (!userQuestion.trim() || !user) return;

        const questionContent = userQuestion.trim();
        setUserQuestion('');

        startTransition(async () => {
            try {
                await askVideoTutor({
                    episodeId: episode.id,
                    question: questionContent,
                    userId: user.id,
                });
                // The onSnapshot listener will automatically update the chat history
            } catch (error) {
                console.error("Error asking video tutor:", error);
                // Optionally add an error message to the chat
                setMessages(prev => [...prev, {
                    id: uuidv4(),
                    role: 'model',
                    content: "죄송합니다, 답변을 생성하는 중에 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
                    createdAt: new Date(),
                }]);
            }
        });
    }

    let lastDate: string | null = null;

    return (
        <div className="flex flex-1 flex-col gap-2 min-h-0">
            <ScrollArea className="flex-grow rounded-md p-4" viewportRef={chatScrollAreaRef}>
                {isLoading ? (
                    <div className="flex items-center justify-center h-full"><Loader className="h-8 w-8 animate-spin" /></div>
                ) : messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center">
                    <Bot className="h-12 w-12 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground mt-2">
                        AI 튜터에게 비디오 내용에 대해 궁금한 점을 검색해보세요.
                    </p>
                </div>
                ) : (
                    <div className="space-y-4">
                        {messages.map(message => {
                            const messageDate = toJSDate(message.createdAt)?.toLocaleDateString('ko-KR');
                            const showSeparator = messageDate && messageDate !== lastDate;
                            if (showSeparator) {
                                lastDate = messageDate;
                            }
                            return (
                                <React.Fragment key={message.id}>
                                    {showSeparator && (
                                        <div className="relative my-4 flex justify-center">
                                            <div className="absolute inset-x-0 top-1/2 -z-10 h-px bg-border" />
                                            <span className="bg-muted px-2 text-xs text-muted-foreground rounded-full">{lastDate}</span>
                                        </div>
                                    )}
                                    <div className={cn("flex items-start gap-3", message.role === 'user' ? 'justify-end' : 'justify-start')}>
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
                                </React.Fragment>
                            )
                        })}
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
             <div className="flex-shrink-0">
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
        </div>
    );
};

const AnalysisView = ({ episode }: { episode: Episode }) => {
    if (!episode.aiGeneratedContent) {
        return (
            <div className="flex-grow flex flex-col items-center justify-center text-center p-4 bg-muted rounded-lg">
                <FileText className="h-12 w-12 text-muted-foreground" />
                <p className="text-sm text-muted-foreground mt-2">
                    {episode.aiProcessingStatus === 'completed'
                        ? '분석된 내용이 없습니다.'
                        : 'AI 분석이 완료되면 강의 요약 내용이 여기에 표시됩니다.'}
                </p>
            </div>
        );
    }
    
    try {
        const data = JSON.parse(episode.aiGeneratedContent);
        return (
            <div className="flex-grow flex flex-col min-h-0">
                <ScrollArea className="h-full w-full rounded-md p-4">
                    <div className="w-full space-y-4">
                        <div className="space-y-1">
                            <h4 className="font-semibold">{episode.title}</h4>
                            <p className="text-base text-foreground whitespace-pre-line break-words">{data.summary || '요약이 없습니다.'}</p>
                        </div>
                        {data.timeline && data.timeline.length > 0 && (
                            <div className="space-y-2">
                                <h4 className="font-semibold flex items-center gap-2"><Clock className="w-4 h-4" />타임라인</h4>
                                <Accordion type="single" collapsible className="w-full">
                                    {data.timeline.map((item: any, i: number) => (
                                        <AccordionItem value={`item-${i}`} key={i} className="border-b-0">
                                            <AccordionTrigger className="text-sm hover:no-underline text-left">
                                                <div className="flex items-start gap-2">
                                                    <span>{item.startTime.split('.')[0]}</span>
                                                    <span>{item.subtitle}</span> 
                                                </div>
                                            </AccordionTrigger>
                                            <AccordionContent className="px-4">
                                                <p className="text-sm text-foreground whitespace-pre-line break-words">{item.description}</p>
                                            </AccordionContent>
                                        </AccordionItem>
                                    ))}
                                </Accordion>
                            </div>
                        )}
                    </div>
                </ScrollArea>
            </div>
        )
    } catch(e) {
        // Fallback for old plain-text content
        return (
            <ScrollArea className="h-full w-full">
                <p className="p-4 text-sm text-muted-foreground whitespace-pre-line break-words">{episode.aiGeneratedContent}</p>
            </ScrollArea>
        )
    }
};

export default function VideoPlayerDialog({ 
  isOpen, 
  onOpenChange, 
  episode, 
  instructor,
  chatMessages,
  setChatMessages,
}: VideoPlayerDialogProps) {
  const { user } = useUser();
  const isMobile = useIsMobile();
  const [isMounted, setIsMounted] = useState(false);
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [vttSrc, setVttSrc] = useState<string | null>(null);
  const [isLoadingSrc, setIsLoadingSrc] = useState(true);
  const [srcError, setSrcError] = useState<string | null>(null);
  const videoKey = episode.id; 
  const startTimeRef = useRef<Date | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const viewLoggedRef = useRef(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const logView = useCallback(() => {
    if (!user || !startTimeRef.current || viewLoggedRef.current) {
      return;
    }
    viewLoggedRef.current = true; // Mark as logged to prevent re-logging

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
  }, [user, episode.id, episode.title, episode.courseId]);

  const handleClose = useCallback(() => {
    const videoElement = document.getElementById(`video-${videoKey}`) as HTMLVideoElement;
    if (videoElement) {
        videoElement.pause();
        videoElement.removeAttribute('src'); 
        videoElement.load();
    }
    
    if (vttSrc && vttSrc.startsWith('blob:')) {
      URL.revokeObjectURL(vttSrc);
    }
    
    logView();
    
    onOpenChange(false);
    setVideoSrc(null);
    setVttSrc(null);
    setIsLoadingSrc(true);
    setSrcError(null);
    startTimeRef.current = null;
  }, [videoKey, vttSrc, logView, onOpenChange]);
  
  useEffect(() => {
    let localVttSrc: string | null = null;
    
    const fetchSources = async () => {
        setIsLoadingSrc(true);
        setSrcError(null);
        setVideoSrc(null);
        setVttSrc(null);

        const videoUrlPromise = episode.filePath ? getSignedUrl(episode.filePath) : Promise.resolve({ error: '비디오 파일 경로를 찾을 수 없습니다.' });
        const vttContentPromise: Promise<{ content?: string; error?: string; }> = episode.vttPath ? getVttContent(episode.vttPath) : Promise.resolve({ content: undefined, error: undefined });

        try {
            const [videoResult, vttResult] = await Promise.all([videoUrlPromise, vttContentPromise]);

            if ('signedURL' in videoResult) {
                setVideoSrc(videoResult.signedURL);
            } else {
                setSrcError(videoResult.error || '비디오 주소를 가져오는 데 실패했습니다.');
            }

            if (vttResult?.content) {
                const blob = new Blob([vttResult.content], { type: 'text/vtt' });
                localVttSrc = URL.createObjectURL(blob);
                setVttSrc(localVttSrc);
            } else if (vttResult?.error) {
                console.warn("Could not fetch VTT content:", vttResult.error);
            }
        } catch (err) {
            console.error("Failed to fetch video sources:", err);
            setSrcError('비디오 또는 자막 소스를 불러오는 데 실패했습니다.');
        } finally {
            setIsLoadingSrc(false);
        }
    };

    if (isOpen) {
        startTimeRef.current = new Date();
        viewLoggedRef.current = false;
        fetchSources();
    }

    return () => {
      // Cleanup function to revoke the blob URL on unmount or when dependencies change
      logView();
      if (localVttSrc) {
        URL.revokeObjectURL(localVttSrc);
      }
    };
  }, [isOpen, episode.id, episode.filePath, episode.vttPath, logView]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !vttSrc) return;

    const setInitialTrackMode = () => {
        if (video.textTracks.length > 0) {
            video.textTracks[0].mode = 'showing';
        }
    };

    if (video.readyState >= 1) { // If metadata is already loaded
        setInitialTrackMode();
    } else {
        video.addEventListener('loadedmetadata', setInitialTrackMode);
    }

    return () => {
        if (video) {
            video.removeEventListener('loadedmetadata', setInitialTrackMode);
        }
    };
  }, [vttSrc]);
  
  const videoProps = {
    id: `video-${videoKey}`,
    crossOrigin: "anonymous" as const,
    controls: true,
    controlsList: "nodownload",
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    autoPlay: true,
    playsInline: true,
    className: "w-full h-full object-contain z-10 relative",
    poster: episode.thumbnailUrl,
  };
  
  const playerAndTabsContent = (
    <div className="flex-grow flex flex-col md:grid md:grid-cols-5 min-w-0 min-h-0">
        <div className="w-full aspect-video bg-black md:col-span-3 md:h-full flex flex-col min-w-0">
            <div className="w-full flex-grow relative">
            <div className="absolute inset-0 flex items-center justify-center">
                {isLoadingSrc && <Loader className="h-12 w-12 text-white animate-spin" />}
                {srcError && !isLoadingSrc && (
                <div className="text-destructive-foreground bg-destructive/80 p-4 rounded-lg text-center">
                    <p className="font-semibold">비디오를 불러올 수 없습니다</p>
                    <p className="text-sm mt-1">{srcError}</p>
                </div>
                )}
            </div>
            {videoSrc && !isLoadingSrc && !srcError && (
                <video ref={videoRef} key={videoSrc} {...videoProps}>
                <source src={videoSrc} type="video/mp4" />
                {vttSrc && (
                    <track src={vttSrc} kind="subtitles" srcLang="ko" label="한국어" />
                )}
                브라우저가 비디오 태그를 지원하지 않습니다.
                </video>
            )}
            </div>
        </div>
        <div className="flex-grow flex flex-col md:col-span-2 border-l min-h-0 md:h-full min-w-0">
            <TabsContent value="summary" className="flex-grow p-4 flex flex-col min-h-0 mt-0">
                <AnalysisView episode={episode} />
            </TabsContent>
            <TabsContent value="tutor" className="flex-grow p-4 flex flex-col min-h-0 mt-0">
                {user ? <ChatView episode={episode} user={user} chatMessages={chatMessages} setChatMessages={setChatMessages} /> : <p className="text-center text-muted-foreground p-8">AI 튜터 기능은 로그인 후 사용 가능합니다.</p>}
            </TabsContent>
        </div>
    </div>
  );

  if (!isMounted) {
    return null;
  }

  const mobileContent = (
    <div className="fixed inset-0 bg-background z-[100] flex flex-col">
        {/* Video Part */}
        <div className="w-full aspect-video bg-black flex flex-col">
            <div className="w-full flex-grow relative">
                <div className="absolute top-2 left-2 right-2 z-20 p-2 bg-gradient-to-b from-black/50 to-transparent rounded-t-lg pointer-events-none">
                    <h2 className="text-white text-base font-bold leading-tight tracking-tight truncate pr-8">
                        {episode.title}
                    </h2>
                </div>
                <div className="absolute inset-0 flex items-center justify-center">
                    {isLoadingSrc && <Loader className="h-12 w-12 text-white animate-spin" />}
                    {srcError && !isLoadingSrc && (
                    <div className="text-destructive-foreground bg-destructive/80 p-4 rounded-lg text-center">
                        <p className="font-semibold">비디오를 불러올 수 없습니다</p>
                        <p className="text-sm mt-1">{srcError}</p>
                    </div>
                    )}
                </div>
                {videoSrc && !isLoadingSrc && !srcError && (
                    <video ref={videoRef} key={videoSrc} {...videoProps}>
                    <source src={videoSrc} type="video/mp4" />
                    {vttSrc && (
                        <track src={vttSrc} kind="subtitles" srcLang="ko" label="한국어" />
                    )}
                    브라우저가 비디오 태그를 지원하지 않습니다.
                    </video>
                )}
            </div>
        </div>

        {/* Tabs Part */}
        <div className="flex-grow flex flex-col border-t min-h-0">
            <Tabs defaultValue="summary" className="flex-grow flex flex-col min-h-0">
                <TabsList className="grid w-full grid-cols-2 flex-shrink-0 rounded-none border-b">
                    <TabsTrigger value="summary">강의 분석</TabsTrigger>
                    <TabsTrigger value="tutor">AI 튜터</TabsTrigger>
                </TabsList>
                <TabsContent value="summary" className="flex-grow p-4 flex flex-col min-h-0 mt-0">
                    <AnalysisView episode={episode} />
                </TabsContent>
                <TabsContent value="tutor" className="flex-grow p-4 flex flex-col min-h-0 mt-0">
                    {user ? <ChatView episode={episode} user={user} chatMessages={chatMessages} setChatMessages={setChatMessages} /> : <p className="text-center text-muted-foreground p-8">AI 튜터 기능은 로그인 후 사용 가능합니다.</p>}
                </TabsContent>
            </Tabs>
        </div>
        <button onClick={handleClose} className="absolute top-2 right-2 z-50 p-2 rounded-full bg-black/50 text-white">
          <X className="h-6 w-6" />
          <span className="sr-only">Close</span>
        </button>
    </div>
  );

  if (isMobile) {
    if (!isOpen) return null;
    return mobileContent;
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) handleClose(); }}>
        <Tabs defaultValue="summary">
            <DialogContent 
                className="w-full h-full p-0 flex flex-col top-0 translate-y-0 rounded-none md:max-w-[90vw] md:h-[90vh] md:rounded-lg md:top-1/2 md:-translate-y-1/2"
                onInteractOutside={(e) => e.preventDefault()}
                onOpenAutoFocus={(e) => e.preventDefault()}
            >
                 <DialogHeader className="p-4 border-b flex-shrink-0 bg-background z-10 hidden md:flex flex-row justify-between items-center space-x-4 min-w-0">
                    <h2 className="text-lg font-bold truncate pr-4 flex-1 text-left">{episode.title}</h2>
                    <div className="flex-none">
                        <TabsList className="grid grid-cols-2 rounded-md h-9 max-w-fit">
                            <TabsTrigger value="summary" className="rounded-l-md rounded-r-none h-full">강의 분석</TabsTrigger>
                            <TabsTrigger value="tutor" className="rounded-r-md rounded-l-none h-full">AI 튜터</TabsTrigger>
                        </TabsList>
                    </div>
                    <div className="flex-1 flex justify-end">
                        <button onClick={handleClose} className="rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
                            <X className="h-4 w-4" />
                            <span className="sr-only">Close</span>
                        </button>
                    </div>
                    <DialogTitle className="sr-only">{episode.title}</DialogTitle>
                    <DialogDescription className="sr-only">{episode.description || `비디오 플레이어: ${episode.title}`}</DialogDescription>
                </DialogHeader>

                {playerAndTabsContent}
            </DialogContent>
        </Tabs>
    </Dialog>
  );
}
