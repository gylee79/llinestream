
/// <reference types="shaka-player" />

'use client';

import type { Episode, Instructor, Course, User, Bookmark } from '@/lib/types';
import React from 'react';
import { Button } from '../ui/button';
import { useUser, useFirestore, useDoc, useMemoFirebase, useCollection } from '@/firebase';
import { logEpisodeView } from '@/lib/actions/log-view';
import { Textarea } from '../ui/textarea';
import { Send, Bot, User as UserIcon, X, Loader, FileText, Clock, ChevronRight, Bookmark as BookmarkIcon, Trash2, Download, AlertTriangle } from 'lucide-react';
import { ScrollArea } from '../ui/scroll-area';
import { askVideoTutor } from '@/ai/flows/video-tutor-flow';
import { cn, getPublicUrl, formatDuration } from '@/lib/utils';
import { v4 as uuidv4 } from 'uuid';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../ui/accordion';
import { collection, query, where, orderBy, onSnapshot, Timestamp as FirebaseTimestamp, doc } from 'firebase/firestore';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogClose } from '@/components/ui/dialog';
import Image from 'next/image';
import { firebaseConfig } from '@/firebase/config';
import { useToast } from '@/hooks/use-toast';
import { Card } from '../ui/card';
import Link from 'next/link';
import { Skeleton } from '../ui/skeleton';
import { addBookmark, deleteBookmark, updateBookmarkNote } from '@/lib/actions/bookmark-actions';
import { Input } from '../ui/input';
import { getHlsPlaybackUrls } from '@/lib/actions/get-hls-playback-urls';

// ========= TYPES AND INTERFACES =========

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

interface VideoPlayerDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  episode: Episode;
  instructor: Instructor | null;
}

// ========= SUB-COMPONENTS =========

const SyllabusView = ({ episode, onSeek }: { episode: Episode, onSeek: (timeInSeconds: number) => void; }) => {
    if (!episode.aiGeneratedContent) {
        return (
            <div className="flex-grow flex flex-col items-center justify-center text-center p-4">
                <FileText className="h-12 w-12 text-muted-foreground" />
                <p className="text-sm text-muted-foreground mt-2 break-keep">AI 분석 중입니다...</p>
            </div>
        );
    }
    
    try {
        const data = JSON.parse(episode.aiGeneratedContent);
        
        const parseTimeToSeconds = (timeStr: string): number => {
            const parts = timeStr.split(':').map(part => parseFloat(part.replace(',', '.')));
            if (parts.length === 3) {
                return parts[0] * 3600 + parts[1] * 60 + parts[2];
            }
            return 0;
        };

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
                                <AccordionItem value={`item-${i}`} key={i} className="border rounded-md mb-1 bg-white overflow-hidden">
                                    <AccordionTrigger 
                                        className="text-sm hover:no-underline text-left px-3 py-2" 
                                        onClick={() => onSeek(parseTimeToSeconds(item.startTime))}
                                    >
                                        <div className="flex items-center gap-2 min-w-0">
                                            <span className="font-mono text-primary font-bold">{item.startTime.split('.')[0]}</span>
                                            <p className="whitespace-normal break-keep">{item.subtitle}</p> 
                                        </div>
                                    </AccordionTrigger>
                                    <AccordionContent className="px-3 pb-3">
                                        <p className="text-sm text-foreground whitespace-pre-line break-keep">{item.description}</p>
                                    </AccordionContent>
                                </AccordionItem>
                            ))}
                        </Accordion>
                    </div>
                )}
            </div>
        )
    } catch(e) {
        return <div className="p-5 text-sm text-muted-foreground">콘텐츠 파싱 오류</div>;
    }
};

const ChatView = ({ episode, user }: { episode: Episode; user: any }) => {
    const firestore = useFirestore();
    const [isPending, startTransition] = React.useTransition();
    const [userQuestion, setUserQuestion] = React.useState('');
    const [messages, setMessages] = React.useState<ChatMessage[]>([]);
    const [isLoading, setIsLoading] = React.useState(true);
    const chatScrollAreaRef = React.useRef<HTMLDivElement>(null);
    const isAIAvailable = episode.aiProcessingStatus === 'completed';

    React.useEffect(() => {
        if (!user || !firestore) return;
        const q = query(collection(firestore, 'users', user.id, 'chats'), where('episodeId', '==', episode.id), orderBy('createdAt', 'asc'));
        return onSnapshot(q, (snapshot) => {
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
        });
    }, [user, episode.id, firestore]);

    const handleAskQuestion = () => {
        if (!userQuestion.trim() || isPending) return;
        const questionContent = userQuestion.trim();
        setMessages(prev => [...prev, { id: uuidv4(), role: 'user', content: questionContent, createdAt: new Date() }]);
        setUserQuestion('');
        startTransition(async () => {
            try { await askVideoTutor({ episodeId: episode.id, question: questionContent, userId: user.id }); } 
            catch { setMessages(prev => [...prev, { id: uuidv4(), role: 'model', content: "죄송합니다, 답변 생성 중 오류가 발생했습니다.", createdAt: new Date() }]); }
        });
    };

    return (
        <div className="flex flex-col h-full p-4">
            <ScrollArea className="flex-grow" viewportRef={chatScrollAreaRef}>
                <div className="space-y-4">
                    {messages.map(m => (
                        <div key={m.id} className={cn("flex items-end gap-2", m.role === 'user' ? 'justify-end' : 'justify-start')}>
                            {m.role === 'model' && <Bot className="h-8 w-8 p-1 bg-primary text-white rounded-full" />}
                            <p className={cn("text-sm p-3 rounded-lg max-w-[80%]", m.role === 'user' ? 'bg-primary text-white' : 'bg-white border')}>{m.content}</p>
                        </div>
                    ))}
                    {isPending && <div className="text-xs text-muted-foreground animate-pulse">AI가 답변을 생각 중입니다...</div>}
                </div>
            </ScrollArea>
            <div className="pt-4 border-t flex gap-2">
                <Textarea value={userQuestion} onChange={(e) => setUserQuestion(e.target.value)} disabled={!isAIAvailable} className="h-10 min-h-0 resize-none" placeholder="비디오에 대해 질문하세요..." />
                <Button onClick={handleAskQuestion} disabled={isPending || !isAIAvailable}><Send className="w-4 h-4"/></Button>
            </div>
        </div>
    );
};

const TextbookView = () => (
    <div className="h-full flex flex-col items-center justify-center p-10 text-center">
        <Image src="https://picsum.photos/seed/textbook/200/280" width={150} height={210} alt="교재" className="rounded-md shadow-md mb-4" />
        <p className="text-sm text-muted-foreground">교재 정보는 현재 준비 중입니다.</p>
        <Button className="mt-4 bg-orange-500 hover:bg-orange-600 text-white">교재 구매하기</Button>
    </div>
);

const BookmarkItem = ({ bookmark, onSeek, onDelete }: { bookmark: Bookmark, onSeek: (time: number) => void, onDelete: (id: string) => void }) => {
    const { user } = useUser();
    const [note, setNote] = React.useState(bookmark.note || '');
    const [isSaving, setIsSaving] = React.useState(false);

    const handleNoteChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value;
        setNote(val);
        setIsSaving(true);
        const timer = setTimeout(async () => {
            if (user) await updateBookmarkNote({ userId: user.id, bookmarkId: bookmark.id, note: val });
            setIsSaving(false);
        }, 1500);
        return () => clearTimeout(timer);
    };

    return (
        <li className="group flex items-center gap-2 p-2 bg-white rounded-md border">
            <Button variant="ghost" onClick={() => onSeek(bookmark.timestamp)} className="font-mono text-primary font-bold px-1 h-8 text-xs">
                [{formatDuration(bookmark.timestamp)}]
            </Button>
            <Input value={note} onChange={handleNoteChange} className="flex-grow h-8 text-sm border-none focus-visible:ring-0" placeholder="메모 입력..." />
            {isSaving && <Loader className="h-3 w-3 animate-spin text-muted-foreground" />}
            <Button variant="ghost" size="icon" onClick={() => onDelete(bookmark.id)} className="opacity-0 group-hover:opacity-100 text-destructive h-8 w-8"><Trash2 className="h-4 w-4"/></Button>
        </li>
    );
};

const BookmarkView = ({ episode, user, videoElement }: { episode: Episode; user: User, videoElement: HTMLVideoElement | null }) => {
    const firestore = useFirestore();
    const { toast } = useToast();
    const bQuery = useMemoFirebase(() => user && firestore ? query(collection(firestore, 'users', user.id, 'bookmarks'), where('episodeId', '==', episode.id), orderBy('timestamp', 'asc')) : null, [user, episode.id]);
    const { data: bookmarks, isLoading } = useCollection<Bookmark>(bQuery);

    const handleAdd = async () => {
        if (!videoElement || !user) return;
        const time = Math.floor(videoElement.currentTime);
        const res = await addBookmark({ userId: user.id, episodeId: episode.id, courseId: episode.courseId, timestamp: time, note: '' });
        if (res.success) toast({ title: "책갈피 추가 완료" });
    };

    return (
        <div className="p-5 space-y-4">
            <Button className="w-full bg-primary" onClick={handleAdd}><BookmarkIcon className="w-4 h-4 mr-2"/> 현재 시간 책갈피</Button>
            {isLoading ? <Loader className="mx-auto animate-spin" /> : (
                <ul className="space-y-2">
                    {bookmarks?.map(b => <BookmarkItem key={b.id} bookmark={b} onSeek={(t) => { if(videoElement) videoElement.currentTime = t; }} onDelete={(id) => deleteBookmark(user.id, id)} />)}
                    {bookmarks?.length === 0 && <p className="text-center text-xs text-muted-foreground">저장된 책갈피가 없습니다.</p>}
                </ul>
            )}
        </div>
    );
};

const PlayerStatusOverlay = ({ episode, isLoading, playerError }: { episode: Episode, isLoading: boolean, playerError: string | null }) => {
    if (playerError) {
        return (
            <div className="absolute inset-0 bg-black/90 z-50 flex flex-col items-center justify-center text-white p-6 text-center">
                <AlertTriangle className="w-12 h-12 text-destructive mb-4"/>
                <p className="font-semibold">재생 오류</p>
                <p className="text-sm text-muted-foreground mt-1">{playerError}</p>
            </div>
        );
    }

    if (isLoading) {
        return (
            <div className="absolute inset-0 bg-black/90 z-50 flex flex-col items-center justify-center text-white">
                <Loader className="w-12 h-12 animate-spin mb-4"/>
                <p className="font-bold">플레이어 로딩 중...</p>
            </div>
        );
    }
    
    if (episode.packagingStatus !== 'completed') {
        const statusText = episode.packagingStatus === 'failed' ? '영상 처리 실패' : '영상 처리 중...';
        const Icon = episode.packagingStatus === 'failed' ? AlertTriangle : Loader;
        const iconColor = episode.packagingStatus === 'failed' ? 'text-destructive' : '';
        
        return (
            <div className="absolute inset-0 bg-black/90 z-50 flex flex-col items-center justify-center text-white p-6 text-center">
                <Icon className={cn("w-12 h-12 mb-4", episode.packagingStatus !== 'failed' && 'animate-spin', iconColor)} />
                <p className="font-bold">{statusText}</p>
                {episode.packagingError && <p className="text-xs text-muted-foreground mt-2 max-w-sm">{episode.packagingError}</p>}
            </div>
        );
    }
    
    return null;
}

// ========= MAIN COMPONENT =========

export default function VideoPlayerDialog({ isOpen, onOpenChange, episode, instructor }: VideoPlayerDialogProps) {
  const { user } = useUser();
  const { toast } = useToast();
  const firestore = useFirestore();
  const [isLoading, setIsLoading] = React.useState(true);
  const [playerError, setPlayerError] = React.useState<string | null>(null);

  const videoRef = React.useRef<HTMLVideoElement>(null);
  const videoContainerRef = React.useRef<HTMLDivElement>(null);
  const shakaPlayerRef = React.useRef<shaka.Player | null>(null);
  const uiRef = React.useRef<shaka.ui.Overlay | null>(null);

  const courseRef = useMemoFirebase(() => (firestore ? doc(firestore, 'courses', episode.courseId) : null), [firestore, episode.courseId]);
  const { data: course } = useDoc<Course>(courseRef);

  const handleSeek = (timeInSeconds: number) => {
    if (videoRef.current) {
        videoRef.current.currentTime = timeInSeconds;
        videoRef.current.play().catch(() => {});
        toast({ title: "이동 완료", description: `${formatDuration(timeInSeconds)} 지점입니다.` });
    }
  };

  React.useEffect(() => {
    let isMounted = true;
    const shaka = (window as any).shaka;

    if (!isOpen) return;
    
    if (!shaka) {
        console.error("Shaka Player is not loaded yet.");
        setPlayerError("플레이어 라이브러리를 로드하는 중입니다. 잠시 후 다시 시도해주세요.");
        setIsLoading(false);
        return;
    }
    
    if (episode.packagingStatus !== 'completed' || !episode.manifestUrl) {
        setIsLoading(false); // Let the overlay handle the status message
        return;
    }
    
    async function initPlayer() {
        if (!videoRef.current || !videoContainerRef.current) return;
        
        try {
            const playbackUrls = await getHlsPlaybackUrls(episode.id);
            if ('error' in playbackUrls) {
                throw new Error(playbackUrls.error);
            }
            if (!isMounted) return;

            const { manifestUrl, keyUrl } = playbackUrls;
            const keyPlaceholderUrl = `https://llinestream.internal/keys/${episode.id}`;

            const player = new shaka.Player();
            shakaPlayerRef.current = player;

            player.configure({
              streaming: { bufferingGoal: 30 },
            });
            
            // Set up request filter to replace placeholder key URL with the signed URL
            player.getNetworkingEngine().registerRequestFilter((type, request) => {
                if (type === shaka.net.NetworkingEngine.RequestType.KEY) {
                    if (request.uris[0] === keyPlaceholderUrl) {
                        request.uris[0] = keyUrl;
                    }
                }
            });

            const ui = new shaka.ui.Overlay(player, videoContainerRef.current!, videoRef.current!);
            uiRef.current = ui;
            
            await player.attach(videoRef.current!);
            player.addEventListener('error', (e: any) => {
              if (isMounted) {
                console.error("Shaka Player Error:", e.detail);
                setPlayerError(`코드: ${e.detail.code}, ${e.detail.message}`);
              }
            });

            await player.load(manifestUrl);

            if (episode.vttPath) {
                const url = getPublicUrl(firebaseConfig.storageBucket, episode.vttPath);
                await player.addTextTrackAsync(url, 'ko', 'subtitle', 'text/vtt');
                player.setTextTrackVisibility(true);
            }

            if (isMounted) setIsLoading(false);
        } catch (e: any) {
            if (isMounted) {
                console.error("Player Initialization Error:", e);
                setPlayerError(e.message || "플레이어를 초기화할 수 없습니다.");
                setIsLoading(false);
            }
        }
    }

    initPlayer();

    return () => { 
        isMounted = false; 
        if (uiRef.current) uiRef.current.destroy();
        if (shakaPlayerRef.current) shakaPlayerRef.current.destroy(); 
    };
  }, [isOpen, episode]);

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-none w-full h-full p-0 flex flex-col border-0 md:max-w-[96vw] md:h-[92vh] md:rounded-2xl overflow-hidden shadow-2xl">
        <DialogHeader className="p-3 border-b flex flex-row justify-between items-center bg-white">
            <div className="flex-1 min-w-0 pl-4">
                <DialogTitle className="text-sm font-bold truncate">
                    {course?.name} <ChevronRight className="inline w-4 h-4 mx-1 text-muted-foreground"/> {episode.title}
                </DialogTitle>
            </div>
            <div className="flex items-center gap-2 pr-4">
                <Button variant="ghost" size="icon" className="h-8 w-8"><Download className="h-4 w-4"/></Button>
                <DialogClose><X className="h-5 w-5"/></DialogClose>
            </div>
        </DialogHeader>
        
        <div className="flex-1 flex flex-col md:grid md:grid-cols-10 overflow-hidden bg-muted/30">
            <div className="col-span-10 md:col-span-7 bg-black relative flex items-center justify-center" ref={videoContainerRef}>
                <PlayerStatusOverlay episode={episode} isLoading={isLoading} playerError={playerError} />
                <video ref={videoRef} className="w-full h-full" autoPlay playsInline playsInline/>
            </div>

            <div className="col-span-10 md:col-span-3 bg-white border-l flex flex-col overflow-hidden">
                <Tabs defaultValue="syllabus" className="flex-1 flex flex-col">
                    <TabsList className="grid w-full grid-cols-4 rounded-none border-b h-12 bg-gray-50/50">
                        <TabsTrigger value="syllabus" className="text-xs">강의목차</TabsTrigger>
                        <TabsTrigger value="search" className="text-xs">강의검색</TabsTrigger>
                        <TabsTrigger value="textbook" className="text-xs">교재정보</TabsTrigger>
                        <TabsTrigger value="bookmark" className="text-xs">책갈피</TabsTrigger>
                    </TabsList>
                    <TabsContent value="syllabus" className="flex-1 overflow-y-auto mt-0"><SyllabusView episode={episode} onSeek={handleSeek}/></TabsContent>
                    <TabsContent value="search" className="flex-1 overflow-y-auto mt-0">{user ? <ChatView episode={episode} user={user}/> : <p className="p-10 text-center text-xs">로그인이 필요합니다.</p>}</TabsContent>
                    <TabsContent value="textbook" className="flex-1 overflow-y-auto mt-0"><TextbookView /></TabsContent>
                    <TabsContent value="bookmark" className="flex-1 overflow-y-auto mt-0">{user ? <BookmarkView episode={episode} user={user} videoElement={videoRef.current}/> : <p className="p-10 text-center text-xs">로그인이 필요합니다.</p>}</TabsContent>
                </Tabs>
            </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
