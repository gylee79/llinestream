
/// <reference types="shaka-player" />

'use client';

import type { Episode, Instructor, Course, User, Bookmark } from '@/lib/types';
import React, { useEffect, useRef, useState, useTransition, useCallback, useMemo } from 'react';
import { Button } from '../ui/button';
import { useUser, useFirestore, useDoc, useMemoFirebase, useCollection } from '@/firebase';
import { logEpisodeView } from '@/lib/actions/log-view';
import { Textarea } from '../ui/textarea';
import { Send, Bot, User as UserIcon, X, Loader, FileText, Clock, ChevronRight, Bookmark as BookmarkIcon, Trash2, Download } from 'lucide-react';
import { ScrollArea } from '../ui/scroll-area';
import { askVideoTutor } from '@/ai/flows/video-tutor-flow';
import { cn, getPublicUrl, formatDuration } from '@/lib/utils';
import { v4 as uuidv4 } from 'uuid';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../ui/accordion';
import { collection, query, where, orderBy, onSnapshot, Timestamp as FirebaseTimestamp, doc } from 'firebase/firestore';
import { toDisplayDate } from '@/lib/date-helpers';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogClose } from '@/components/ui/dialog';
import Image from 'next/image';
import { firebaseConfig } from '@/firebase/config';
import { useToast } from '@/hooks/use-toast';
import { Card } from '../ui/card';
import Link from 'next/link';
import { Skeleton } from '../ui/skeleton';
import { addBookmark, deleteBookmark, updateBookmarkNote } from '@/lib/actions/bookmark-actions';
import { Input } from '../ui/input';

// Import Shaka Player
import shaka from 'shaka-player/dist/shaka-player.ui.js';
import 'shaka-player/dist/controls.css';

// ========= TYPES AND SUB-COMPONENTS (Self-contained) =========

interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  content: string;
  createdAt: Date;
}

interface ChatLog {
  id: string;
  userId: string;
  episodeId: string;
  courseId: string;
  question: string;
  answer: string;
  contextReferences: string[];
  createdAt: FirebaseTimestamp;
}

const SyllabusView = ({ episode }: { episode: Episode }) => {
    if (!episode.aiGeneratedContent) {
        return (
            <div className="flex-grow flex flex-col items-center justify-center text-center p-4">
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
            <div className="space-y-4 p-5 pr-6">
                <div className="space-y-1">
                    <h4 className="font-semibold text-base">강의 요약</h4>
                    <p className="text-sm text-foreground whitespace-pre-line break-keep [word-break:keep-all]">{data.summary || '요약이 없습니다.'}</p>
                </div>
                {data.timeline && data.timeline.length > 0 && (
                    <div className="space-y-2">
                        <h4 className="font-semibold flex items-center gap-2 text-base"><Clock className="w-4 h-4" />타임라인</h4>
                        <Accordion type="single" collapsible className="w-full">
                            {data.timeline.map((item: any, i: number) => (
                                <AccordionItem value={`item-${i}`} key={i} className="border rounded-md mb-1 bg-white">
                                    <AccordionTrigger className="text-sm hover:no-underline text-left px-3 py-2">
                                        <div className="flex items-center gap-2 min-w-0">
                                            <span className="font-mono">{item.startTime.split('.')[0]}</span>
                                            <p className="break-keep [word-break:keep-all]">{item.subtitle}</p> 
                                        </div>
                                    </AccordionTrigger>
                                    <AccordionContent className="px-3 pb-3">
                                        <p className="text-sm text-foreground whitespace-pre-line break-keep [word-break:keep-all]">{item.description}</p>
                                    </AccordionContent>
                                </AccordionItem>
                            ))}
                        </Accordion>
                    </div>
                )}
            </div>
        )
    } catch(e) {
        return (
            <div className="p-5 pr-6">
                <p className="text-sm text-muted-foreground whitespace-pre-wrap break-keep [word-break:keep-all]">{episode.aiGeneratedContent}</p>
            </div>
        )
    }
};

const ChatView = ({ episode, user }: { episode: Episode; user: any }) => {
    const firestore = useFirestore();
    const [isPending, startTransition] = useTransition();
    const [userQuestion, setUserQuestion] = useState('');
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const chatScrollAreaRef = useRef<HTMLDivElement>(null);

    const isAIAvailable = episode.aiProcessingStatus === 'completed';

    useEffect(() => {
        if (!user || !firestore) {
            setIsLoading(false);
            setMessages([]);
            return;
        }

        const q = query(
            collection(firestore, 'users', user.id, 'chats'), 
            where('episodeId', '==', episode.id), 
            orderBy('createdAt', 'asc')
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const logs = snapshot.docs.map(doc => doc.data() as ChatLog);
            const newMessages = logs.flatMap(log => {
                const logDate = (log.createdAt as FirebaseTimestamp)?.toDate() || new Date();
                return [
                    { id: `${log.id}-q`, role: 'user' as const, content: log.question, createdAt: logDate },
                    { id: `${log.id}-a`, role: 'model' as const, content: log.answer, createdAt: new Date(logDate.getTime() + 1) }
                ];
            });
            setMessages(newMessages);
            setIsLoading(false);
        }, (error) => {
            console.error("Error fetching chat history:", error);
            setIsLoading(false);
        });

        return () => unsubscribe();
    }, [user, episode.id, firestore]);

    useEffect(() => {
        chatScrollAreaRef.current?.scrollTo({ top: chatScrollAreaRef.current.scrollHeight, behavior: 'smooth' });
    }, [messages, isPending]);

    const handleAskQuestion = () => {
        if (!userQuestion.trim() || !user || isPending) return;
        const questionContent = userQuestion.trim();
        setMessages(prev => [...prev, { id: uuidv4(), role: 'user', content: questionContent, createdAt: new Date() }]);
        setUserQuestion('');
        startTransition(async () => {
            try {
                const result = await askVideoTutor({ episodeId: episode.id, question: questionContent, userId: user.id });
                // The onSnapshot listener will automatically add the new message from the database
            } catch (error) {
                setMessages(prev => [...prev, { id: uuidv4(), role: 'model', content: "죄송합니다, 답변 생성 중 오류가 발생했습니다.", createdAt: new Date() }]);
            }
        });
    };

    return (
        <div className="flex flex-col h-full p-4">
            <ScrollArea className="flex-grow -mx-4 px-4" viewportRef={chatScrollAreaRef}>
                <div className="space-y-4">
                  {isLoading ? (
                      <div className="flex items-center justify-center h-full"><Loader className="h-8 w-8 animate-spin" /></div>
                  ) : messages.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-full text-center p-4">
                          <Bot className="h-12 w-12 text-muted-foreground" />
                          <p className="text-sm text-muted-foreground mt-2">AI 튜터에게 비디오 내용에 대해 궁금한 점을 질문해보세요.</p>
                      </div>
                  ) : (
                      messages.map(message => {
                        const formattedContent = message.role === 'model'
                            ? message.content.replace(/(\d{2}:\d{2}:\d{2})\.\d+/g, '$1')
                            : message.content;
                        return (
                            <div key={message.id} className={cn("flex items-end gap-2", message.role === 'user' ? 'justify-end' : 'justify-start')}>
                                {message.role === 'model' && <div className="flex-shrink-0 h-8 w-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center"><Bot className="h-5 w-5" /></div>}
                                <p className={cn("text-sm p-3 rounded-lg max-w-sm whitespace-pre-line", message.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-white border')}>{formattedContent}</p>
                            </div>
                        )
                      })
                  )}
                  {isPending && (
                      <div className="flex items-start gap-2 pt-4">
                          <div className="flex-shrink-0 h-8 w-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center"><Bot className="h-5 w-5 animate-spin" /></div>
                          <div className="p-3 rounded-lg bg-white border text-sm text-muted-foreground">답변을 생각하고 있어요...</div>
                      </div>
                  )}
                </div>
            </ScrollArea>
            <div className="flex-shrink-0 pt-4 border-t">
                <div className="flex gap-2">
                    <Textarea 
                        placeholder={!isAIAvailable ? "AI 분석이 아직 완료되지 않았습니다." : "AI에게 질문할 내용을 입력하세요..."}
                        value={userQuestion}
                        onChange={(e) => setUserQuestion(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !isPending) { e.preventDefault(); handleAskQuestion(); } }}
                        disabled={isPending || !isAIAvailable}
                        className="flex-grow resize-none min-h-0 h-10"
                        rows={1}
                    />
                    <Button onClick={handleAskQuestion} disabled={isPending || !userQuestion.trim() || !isAIAvailable}><Send className="h-4 w-4" /></Button>
                </div>
            </div>
        </div>
    );
};

const TextbookView = () => (
    <div className="h-full p-4">
        <div className="text-center flex flex-col items-center h-full justify-center">
            <Image src="https://picsum.photos/seed/textbook/200/280" width={150} height={210} alt="교재 이미지" className="rounded-md shadow-md" />
            <p className="text-sm text-muted-foreground mt-4">교재 정보는 현재 준비 중입니다.</p>
            <Button className="mt-4 bg-orange-500 hover:bg-orange-600 text-white font-bold">교재 구매하기</Button>
        </div>
    </div>
);

const BookmarkItem = ({ bookmark, onSeek, onDelete }: { bookmark: Bookmark, onSeek: (time: number) => void, onDelete: (id: string) => void }) => {
    const { user } = useUser();
    const { toast } = useToast();
    const [note, setNote] = useState(bookmark.note || '');
    const [isSaving, setIsSaving] = useState(false);
    const timeoutRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        setNote(bookmark.note || '');
    }, [bookmark.note]);

    const handleNoteChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newNote = e.target.value;
        setNote(newNote);
        setIsSaving(true);
        
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        
        timeoutRef.current = setTimeout(() => {
            if (!user) return;
            updateBookmarkNote({ userId: user.id, bookmarkId: bookmark.id, note: newNote })
                .then(result => {
                    if (!result.success) {
                        toast({ variant: 'destructive', title: '메모 저장 실패', description: result.message });
                    }
                })
                .finally(() => {
                    setIsSaving(false);
                });
        }, 1500); // 1.5-second debounce
    };

    return (
        <li className="group flex items-center gap-2 p-2 bg-white rounded-md border">
            <Button variant="ghost" onClick={() => onSeek(bookmark.timestamp)} className="flex-shrink-0 flex-grow-0 font-mono text-primary font-semibold px-0 h-8 text-xs">
                [{formatDuration(bookmark.timestamp)}]
            </Button>
            <Input
                value={note}
                onChange={handleNoteChange}
                placeholder="메모 입력..."
                className="flex-grow h-8 text-sm border-0 focus-visible:ring-1 focus-visible:ring-ring"
            />
             {isSaving && <Loader className="h-4 w-4 animate-spin text-muted-foreground" />}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={() => onDelete(bookmark.id)}
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
        </li>
    );
}

const BookmarkView = ({ episode, user, videoElement }: { episode: Episode; user: User, videoElement: HTMLVideoElement | null }) => {
    const firestore = useFirestore();
    const { toast } = useToast();
    const [isSaving, setIsSaving] = useState(false);

    const bookmarksQuery = useMemoFirebase(() => {
        if (!user || !firestore) return null;
        return query(
            collection(firestore, 'bookmarks'),
            where('userId', '==', user.id),
            where('episodeId', '==', episode.id),
            orderBy('timestamp', 'asc')
        );
    }, [user.id, episode.id, firestore]);

    const { data: bookmarks, isLoading, error: bookmarksError } = useCollection<Bookmark>(bookmarksQuery);

    useEffect(() => {
        if (bookmarksError) {
            console.error("Firestore query error:", bookmarksError);
            if (bookmarksError.message.includes("indexes")) {
                 toast({
                    variant: "destructive",
                    title: "색인 필요",
                    description: "책갈피를 불러오려면 Firestore 색인 생성이 필요합니다. 브라우저 콘솔의 링크를 클릭하여 색인을 생성해주세요.",
                    duration: 10000,
                });
            }
        }
    }, [bookmarksError, toast]);

    const handleAddBookmark = () => {
        if (!videoElement || !user || !firestore) return;
        
        videoElement.pause();
        const currentTime = Math.floor(videoElement.currentTime);

        if (bookmarks?.some(b => b.timestamp === currentTime)) {
            toast({ variant: 'destructive', title: '오류', description: '이미 같은 시간에 책갈피가 존재합니다.' });
            videoElement.play();
            return;
        }

        setIsSaving(true);
        addBookmark({
            userId: user.id,
            episodeId: episode.id,
            courseId: episode.courseId,
            timestamp: currentTime,
            note: '',
        }).then((result) => {
            if (result.success) {
                toast({ title: '성공', description: '책갈피가 추가되었습니다.' });
            } else {
                toast({ variant: 'destructive', title: '오류', description: result.message });
            }
        }).catch(error => {
            toast({ variant: 'destructive', title: '오류', description: '책갈피 추가 중 예외가 발생했습니다.' });
            console.error(error);
        }).finally(() => {
            setIsSaving(false);
            videoElement.play();
        });
    };

    const handleDeleteBookmark = (bookmarkId: string) => {
        if (!user || !firestore) return;

        deleteBookmark(user.id, bookmarkId).then(result => {
            if (result.success) {
                toast({ title: '성공', description: '북마크가 삭제되었습니다.' });
            } else {
                toast({ variant: 'destructive', title: '오류', description: result.message });
            }
        }).catch(error => {
            toast({ variant: 'destructive', title: '오류', description: '북마크 삭제 중 예외가 발생했습니다.' });
            console.error(error);
        });
    };
    
    const handleSeekTo = (time: number) => {
        if (videoElement) {
            videoElement.currentTime = time;
            videoElement.play();
        }
    };
    
    return (
        <div className="space-y-4 p-5 pr-6">
            <Button 
                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
                onClick={handleAddBookmark}
                disabled={isSaving}
            >
              <BookmarkIcon className="mr-2 h-4 w-4" /> 
              {isSaving ? '저장 중...' : '현재 시간 책갈피'}
            </Button>
            
            <div className="mt-4 space-y-2">
                {isLoading && <p className="text-center text-sm text-muted-foreground">책갈피 로딩 중...</p>}
                
                {!isLoading && bookmarks && bookmarks.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center pt-4">저장된 책갈피가 없습니다.</p>
                )}

                {!isLoading && bookmarks && bookmarks.length > 0 && (
                    <ul className="space-y-2">
                        {bookmarks.map(bookmark => (
                            <BookmarkItem 
                                key={bookmark.id} 
                                bookmark={bookmark}
                                onSeek={handleSeekTo}
                                onDelete={handleDeleteBookmark}
                            />
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
};

// ========= MAIN COMPONENT =========

interface VideoPlayerDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  episode: Episode;
  instructor: Instructor | null;
}

export default function VideoPlayerDialog({ isOpen, onOpenChange, episode, instructor }: VideoPlayerDialogProps) {
  const { user } = useUser();
  const { toast } = useToast();
  const firestore = useFirestore();
  
  const [isLoading, setIsLoading] = useState(true);
  const [playerError, setPlayerError] = useState<string | null>(null);

  const startTimeRef = useRef<Date | null>(null);
  const viewLoggedRef = useRef(false);

  const shakaPlayerRef = useRef<shaka.Player | null>(null);
  const uiRef = useRef<shaka.ui.Overlay | null>(null);
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const courseRef = useMemoFirebase(() => (firestore ? doc(firestore, 'courses', episode.courseId) : null), [firestore, episode.courseId]);
  const { data: course, isLoading: courseLoading } = useDoc<Course>(courseRef);

  const logView = useCallback(() => {
    if (!user || !startTimeRef.current || viewLoggedRef.current) return;
    viewLoggedRef.current = true;
    const endTime = new Date();
    const durationWatched = (endTime.getTime() - startTimeRef.current.getTime()) / 1000;

    if (durationWatched > 1) {
      logEpisodeView({
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        episodeId: episode.id,
        episodeTitle: episode.title,
        courseId: episode.courseId,
        startedAt: startTimeRef.current,
        endedAt: endTime,
      });
    }
  }, [user, episode]);

  const handleDownload = () => {
    toast({
        title: "다운로드 기능 준비 중",
        description: "DRM 콘텐츠 오프라인 저장은 Shaka Player의 Storage API를 통해 구현됩니다. 이 기능은 현재 개발 중입니다."
    });
  };

  const onPlayerError = useCallback((error: any) => {
    const shakaError = error instanceof shaka.util.Error ? error : error.detail;
    console.error("Shaka Player Error Details:");
    console.dir(shakaError);
    
    let message = `알 수 없는 플레이어 오류가 발생했습니다 (코드: ${shakaError.code}).`;
    if (shakaError && shakaError.category) {
        switch (shakaError.category) {
            case shaka.util.Error.Category.NETWORK:
                message = `네트워크 오류로 비디오를 불러올 수 없습니다.
                브라우저 콘솔(F12)에서 CORS 관련 오류 메시지가 있는지 확인해주세요.
                만약 CORS 오류가 발생했다면, 터미널에서 다음 명령어를 실행하여 스토리지 설정을 업데이트해야 합니다:
                gcloud storage buckets update gs://<YOUR_BUCKET_NAME> --cors-file=cors.json`;
                break;
            case shaka.util.Error.Category.DRM:
                message = `DRM 라이선스 요청에 실패했습니다 (코드: ${shakaError.code}). 키 서버 URL 또는 DRM 관련 설정이 올바른지 확인해주세요.`;
                break;
            case shaka.util.Error.Category.MEDIA:
                message = `미디어 파일을 재생할 수 없습니다 (코드: ${shakaError.code}). 파일이 손상되었거나 지원되지 않는 형식일 수 있습니다.`;
                break;
            default:
                message = `플레이어 오류가 발생했습니다 (코드: ${shakaError.code}). 자세한 내용은 콘솔을 확인해주세요.`;
        }
    }
    setPlayerError(message);
    setIsLoading(false);
  }, []);


    useEffect(() => {
        if (isOpen) {
            startTimeRef.current = new Date();
            viewLoggedRef.current = false;
        }
        return () => {
            if (isOpen) logView();
        };
    }, [isOpen, logView]);


    useEffect(() => {
        let isMounted = true;
        
        async function setupPlayer() {
            if (!videoRef.current || !videoContainerRef.current) return;
            
            setIsLoading(true);
            setPlayerError(null);

            if (episode.packagingStatus !== 'completed') {
                const statusMessage = episode.packagingStatus === 'failed'
                    ? '비디오 처리 중 오류가 발생했습니다. 관리자에게 문의해주세요.'
                    : '영상을 재생 가능하도록 암호화하고 있습니다. 잠시 후 다시 시도해주세요.';
                setPlayerError(statusMessage);
                setIsLoading(false);
                return;
            }
            
            if (!episode.manifestUrl) {
                setPlayerError('재생할 영상 주소(manifestUrl)가 없습니다.');
                setIsLoading(false);
                return;
            }

            if (!episode.keyServerUrl) {
                 setPlayerError('암호화된 영상을 재생하는 데 필요한 키 서버 URL이 없습니다. 에피소드 데이터나 백엔드 로직을 확인해주세요.');
                 setIsLoading(false);
                 return;
            }

            const player = new shaka.Player();
            const ui = new shaka.ui.Overlay(player, videoContainerRef.current, videoRef.current);
            shakaPlayerRef.current = player;
            uiRef.current = ui;

            try {
                await player.attach(videoRef.current);
                
                player.getNetworkingEngine()?.registerRequestFilter((type, request) => {
                    // Intercept any request URI that starts with gs://, as this is the placeholder for our key.
                    if (request.uris[0].startsWith('gs://')) {
                         console.log(`[Shaka-Filter] 가로챈 URI: ${request.uris[0]}`);
                         console.log(`[Shaka-Filter] 서명된 keyServerUrl로 교체합니다.`);
                         request.uris[0] = episode.keyServerUrl!;
                    }
                });

                player.addEventListener('error', onPlayerError);
                await player.load(episode.manifestUrl);
                
                const bucketName = firebaseConfig.storageBucket;
                if (episode.vttPath && bucketName) {
                    const publicVttUrl = getPublicUrl(bucketName, episode.vttPath);
                    await player.addTextTrackAsync(publicVttUrl, 'ko', 'subtitle', 'text/vtt');
                    player.setTextTrackVisibility(true);
                }

                if(isMounted) setIsLoading(false);
            } catch (e: any) {
                if(isMounted) onPlayerError(e);
            }
        }

        if (isOpen) {
            setupPlayer();
        }

        return () => {
            isMounted = false;
            if (uiRef.current) {
                uiRef.current.destroy();
                uiRef.current = null;
            }
            if (shakaPlayerRef.current) {
                shakaPlayerRef.current.destroy();
                shakaPlayerRef.current = null;
            }
        };
    }, [isOpen, episode, onPlayerError]);


  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-none w-full h-full p-0 flex flex-col border-0 md:max-w-[96vw] md:h-[92vh] md:rounded-2xl"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => {
          if (videoContainerRef.current && videoContainerRef.current.contains(e.target as Node)) {
            e.preventDefault();
          }
        }}
      >
        <DialogHeader className="p-1 border-b flex-shrink-0 flex flex-row items-center justify-between min-h-[41px]">
            <div className="text-sm font-medium text-muted-foreground line-clamp-1 pr-8">
                {courseLoading ? (
                    <Skeleton className="h-5 w-48" />
                ) : (
                    <>
                    <Link href={`/courses/${episode.courseId}`} className="hover:underline">{course?.name}</Link>
                    <ChevronRight className="h-4 w-4 inline-block mx-1" />
                    <span>{episode.title}</span>
                    </>
                )}
            </div>
             <div className="flex items-center gap-1">
                 <Button variant="ghost" size="icon" onClick={handleDownload} className="w-8 h-8">
                     <Download className="h-4 w-4" />
                 </Button>
                <DialogClose className="flex items-center justify-center w-8 h-8 rounded-full hover:bg-muted">
                    <X className="h-4 w-4" />
                </DialogClose>
             </div>
             <DialogTitle className="sr-only">{`영상 플레이어: ${episode.title}`}</DialogTitle>
             <DialogDescription className="sr-only">{`'${episode.title}' 영상을 재생하고 관련 학습 활동을 할 수 있는 다이얼로그입니다.`}</DialogDescription>
        </DialogHeader>
        <div className="flex-1 flex flex-col md:grid md:grid-cols-10 gap-0 md:gap-6 md:px-6 md:pb-6 overflow-hidden bg-muted/50">
            {/* Video Player Section */}
            <Card className="col-span-10 md:col-span-7 flex flex-col bg-black md:rounded-xl overflow-hidden shadow-lg border-border">
                <div className="w-full flex-grow relative" ref={videoContainerRef}>
                    {(isLoading || playerError) && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-white bg-black/50 p-4 text-center">
                             {isLoading && !playerError && (
                                <>
                                    <Loader className="h-12 w-12 text-white animate-spin mb-4" />
                                    <div>{episode.packagingStatus !== 'completed' ? '영상을 재생 가능하도록 암호화하고 있습니다. 잠시 후 다시 시도해주세요.' : '플레이어 로딩 중...'}</div>
                                </>
                            )}
                            {playerError && (
                                <div className="text-sm max-w-md whitespace-pre-line">{playerError}</div>
                            )}
                        </div>
                    )}
                    <video ref={videoRef} className="w-full h-full" autoPlay playsInline />
                </div>
            </Card>

            {/* Sidebar Section */}
            <Card className="col-span-10 md:col-span-3 flex-1 md:flex-auto flex flex-col md:bg-card md:rounded-xl shadow-lg border-border overflow-hidden min-w-0">
                <Tabs defaultValue="syllabus" className="flex-1 flex flex-col min-h-0">
                    <TabsList className="grid w-full grid-cols-4 flex-shrink-0 rounded-none h-auto p-0 bg-gray-50 border-b">
                        <TabsTrigger value="syllabus" className="py-3 rounded-none text-muted-foreground data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-none data-[state=active]:font-semibold relative after:content-[''] after:absolute after:bottom-[-1px] after:left-0 after:right-0 after:h-0.5 after:bg-primary after:scale-x-0 after:transition-transform data-[state=active]:after:scale-x-100">강의목차</TabsTrigger>
                        <TabsTrigger value="search" className="py-3 rounded-none text-muted-foreground data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-none data-[state=active]:font-semibold relative after:content-[''] after:absolute after:bottom-[-1px] after:left-0 after:right-0 after:h-0.5 after:bg-primary after:scale-x-0 after:transition-transform data-[state=active]:after:scale-x-100">강의 검색</TabsTrigger>
                        <TabsTrigger value="textbook" className="py-3 rounded-none text-muted-foreground data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-none data-[state=active]:font-semibold relative after:content-[''] after:absolute after:bottom-[-1px] after:left-0 after:right-0 after:h-0.5 after:bg-primary after:scale-x-0 after:transition-transform data-[state=active]:after:scale-x-100">교재정보</TabsTrigger>
                        <TabsTrigger value="bookmark" className="py-3 rounded-none text-muted-foreground data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-none data-[state=active]:font-semibold relative after:content-[''] after:absolute after:bottom-[-1px] after:left-0 after:right-0 after:h-0.5 after:bg-primary after:scale-x-0 after:transition-transform data-[state=active]:after:scale-x-100">책갈피</TabsTrigger>
                    </TabsList>
                    <TabsContent value="syllabus" className="mt-0 flex-grow min-h-0 bg-white flex flex-col">
                        <ScrollArea className="h-full w-full">
                            <SyllabusView episode={episode} />
                        </ScrollArea>
                    </TabsContent>
                    <TabsContent value="search" className="mt-0 flex-grow min-h-0 bg-white flex flex-col">
                         {user ? <ChatView episode={episode} user={user} /> : <div className="flex-grow flex items-center justify-center p-4 text-sm text-muted-foreground">로그인 후 사용 가능합니다.</div>}
                    </TabsContent>
                    <TabsContent value="textbook" className="mt-0 flex-grow min-h-0 bg-white flex flex-col">
                        <TextbookView />
                    </TabsContent>
                    <TabsContent value="bookmark" className="mt-0 flex-grow min-h-0 bg-white flex flex-col">
                        {user ? <ScrollArea className="h-full w-full"><BookmarkView episode={episode} user={user} videoElement={shakaPlayerRef.current?.getMediaElement() ?? null}/></ScrollArea> : <div className="flex-grow flex items-center justify-center p-4 text-sm text-muted-foreground">로그인 후 사용 가능합니다.</div>}
                    </TabsContent>
                </Tabs>
            </Card>
        </div>
      </DialogContent>
    </Dialog>
  );
}
