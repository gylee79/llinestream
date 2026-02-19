'use client';

import type { Episode, Instructor, Course, User, Bookmark, OfflineVideoData, CryptoWorkerResponse, PlayerState, ChatLog, ChatMessage, OfflineLicense, VideoManifest } from '@/lib/types';
import React from 'react';
import { Button } from '../ui/button';
import { useUser, useFirestore, useDoc, useMemoFirebase, useCollection, useAuth } from '@/firebase';
import { Textarea } from '../ui/textarea';
import { Send, Bot, User as UserIcon, X, Loader, FileText, Clock, ChevronRight, Bookmark as BookmarkIcon, Trash2, Download, AlertTriangle, CheckCircle, RotateCcw } from 'lucide-react';
import { ScrollArea } from '../ui/scroll-area';
import { askVideoTutor } from '@/ai/flows/video-tutor-flow';
import { cn, formatDuration } from '@/lib/utils';
import { v4 as uuidv4 } from 'uuid';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../ui/accordion';
import { collection, query, where, orderBy, onSnapshot, Timestamp as FirebaseTimestamp, doc } from 'firebase/firestore';
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogClose } from '@/components/ui/dialog';
import Image from 'next/image';
import { useToast } from '@/hooks/use-toast';
import { Card } from '../ui/card';
import { Skeleton } from '../ui/skeleton';
import { addBookmark, deleteBookmark, updateBookmarkNote } from '@/lib/actions/bookmark-actions';
import { Input } from '../ui/input';
import { saveVideo } from '@/lib/offline-db';
import { getSignedUrl as getSignedUrlAction } from '@/lib/actions/get-signed-url';
import { endPlaySession, heartbeatPlaySession } from '@/lib/actions/session-actions';


// Stage 3: Playback Debugging Structure
const PLAYBACK_STAGES = {
  STAGE_1_PLAY_SESSION: 'STAGE_1_PLAY_SESSION',
  STAGE_2_MANIFEST_FETCH: 'STAGE_2_MANIFEST_FETCH',
  STAGE_3_SEGMENT_URL_REQUEST: 'STAGE_3_SEGMENT_URL_REQUEST',
  STAGE_4_SEGMENT_DOWNLOAD: 'STAGE_4_SEGMENT_DOWNLOAD',
  STAGE_5_WORKER_DECRYPT: 'STAGE_5_WORKER_DECRYPT',
  STAGE_6_MSE_APPEND: 'STAGE_6_MSE_APPEND',
  STAGE_7_VIDEO_PLAY: 'STAGE_7_VIDEO_PLAY',
} as const;

type PlaybackStage = keyof typeof PLAYBACK_STAGES;

const logStage = (stage: PlaybackStage, status: 'START' | 'SUCCESS' | 'FAIL', message?: string) => {
    const baseMessage = `[Player] ${stage}: ${status}`;
    const fullMessage = message ? `${baseMessage} - ${message}` : baseMessage;
    if (status === 'FAIL') {
        console.error(fullMessage);
    } else {
        console.log(fullMessage);
    }
};


type DownloadState = 'idle' | 'checking' | 'downloading' | 'saving' | 'completed' | 'forbidden' | 'error';

const DownloadButton = ({
    downloadState,
    onDownload,
    reasonDisabled
}: {
    downloadState: DownloadState;
    onDownload: () => void;
    reasonDisabled?: string;
}) => {
    switch (downloadState) {
        case 'checking':
        case 'downloading':
        case 'saving':
            return (
                <Button variant="outline" disabled>
                    <Loader className="mr-2 h-4 w-4 animate-spin" />
                    {downloadState === 'checking' && '권한 확인 중...'}
                    {downloadState === 'downloading' && '다운로드 중...'}
                    {downloadState === 'saving' && '저장 중...'}
                </Button>
            );
        case 'completed':
            return (
                <Button variant="outline" disabled>
                    <CheckCircle className="mr-2 h-4 w-4 text-green-500" />
                    저장 완료
                </Button>
            );
        case 'forbidden':
            return (
                 <Button variant="outline" disabled title={reasonDisabled}>
                    <AlertTriangle className="mr-2 h-4 w-4 text-yellow-500" />
                    저장 불가
                </Button>
            );
        case 'error':
            return (
                <Button variant="destructive" onClick={onDownload}>
                    <RotateCcw className="mr-2 h-4 w-4" />
                    다운로드 재시도
                </Button>
            );
        case 'idle':
        default:
            return (
                <Button variant="outline" onClick={onDownload}>
                    <Download className="mr-2 h-4 w-4" />
                    오프라인 저장
                </Button>
            );
    }
};

const SyllabusView = ({ episode, onSeek, offlineVideoData }: { 
    episode: Episode, 
    onSeek: (timeInSeconds: number) => void; 
    offlineVideoData?: OfflineVideoData | null;
}) => {
    const { authUser } = useUser();
    const [aiContent, setAiContent] = React.useState<any>(offlineVideoData?.aiContent || null);
    const [isLoading, setIsLoading] = React.useState(!offlineVideoData?.aiContent);
    const [error, setError] = React.useState<string | null>(null);

    React.useEffect(() => {
        if (offlineVideoData?.aiContent) {
            setAiContent(offlineVideoData.aiContent);
            setIsLoading(false);
            return;
        }

        const fetchAiContent = async () => {
            if (episode.ai.status !== 'completed' || !episode.ai.resultPaths?.search_data) {
                setIsLoading(false);
                return;
            }
            if (!authUser) {
                setIsLoading(false);
                setError("AI 콘텐츠를 보려면 로그인이 필요합니다.");
                return;
            }

            setIsLoading(true);
            setError(null);
            try {
                const token = await authUser.getIdToken();
                const searchDataPath = episode.ai.resultPaths.search_data;
                
                if (!searchDataPath) {
                    throw new Error("AI 분석 요약 파일 경로를 찾을 수 없습니다.");
                }

                const { signedUrl, error: urlError } = await getSignedUrlAction(token, episode.id, searchDataPath);
                
                if (urlError || !signedUrl) {
                    throw new Error(urlError || 'AI 콘텐츠 접근 URL 생성에 실패했습니다.');
                }

                const response = await fetch(signedUrl);
                if (!response.ok) {
                    throw new Error('AI 콘텐츠를 다운로드하지 못했습니다.');
                }

                const content = await response.json();
                setAiContent(content);
            } catch (err: any) {
                console.error("Failed to load syllabus content:", err);
                setError(err.message || 'AI 콘텐츠를 불러오는 중 오류가 발생했습니다.');
                setAiContent(null);
            } finally {
                setIsLoading(false);
            }
        };

        fetchAiContent();
    }, [episode.id, episode.ai.status, episode.ai.resultPaths?.search_data, authUser, offlineVideoData]);


    if (isLoading) {
        return (
            <div className="flex-grow flex flex-col items-center justify-center text-center p-4">
                <Loader className="h-12 w-12 text-muted-foreground animate-spin" />
                <p className="text-sm text-muted-foreground mt-4">AI 분석 데이터를 불러오는 중...</p>
            </div>
        );
    }
    
    if (error) {
         return (
            <div className="flex-grow flex flex-col items-center justify-center text-center p-4">
                <AlertTriangle className="h-12 w-12 text-destructive" />
                <p className="font-semibold mt-4">오류 발생</p>
                <p className="text-sm text-muted-foreground mt-2 break-keep">{error}</p>
            </div>
        );
    }
    
    if (episode.ai.status === 'failed') {
        return (
            <div className="flex-grow flex flex-col items-center justify-center text-center p-4">
                <AlertTriangle className="h-12 w-12 text-destructive" />
                <p className="font-semibold mt-4">AI 분석 실패</p>
                <p className="text-sm text-muted-foreground mt-2 break-keep">
                    강의 요약 및 타임라인을 생성하지 못했습니다.
                </p>
                {episode.ai.error?.message && (
                    <p className="text-xs text-muted-foreground mt-2 break-keep max-w-sm p-2 bg-destructive/10 rounded-md">
                        오류 원인: {episode.ai.error.message}
                    </p>
                )} 
                 <p className="text-xs text-muted-foreground mt-4 break-keep">
                    관리자 페이지에서 재분석을 시도할 수 있습니다.
                </p>
            </div>
        );
    }
    
    if (!aiContent) {
        return (
            <div className="flex-grow flex flex-col items-center justify-center text-center p-4">
                <FileText className="h-12 w-12 text-muted-foreground" />
                <p className="text-sm text-muted-foreground mt-4 break-keep">AI가 강의 내용을 분석하고 있습니다.<br/>잠시 후 다시 시도해주세요.</p>
            </div>
        );
    }
    
    try {
        const data = aiContent;
        
        const parseTimeToSeconds = (timeStr: string): number => {
            if (!timeStr) return 0;
            const parts = timeStr.split(':').map(part => parseFloat(part.replace(',', '.')));
            if (parts.length === 3) {
                return parts[0] * 3600 + parts[1] * 60 + parts[2];
            }
            return 0;
        };

        return (
            <div className="space-y-4 p-4 pr-6">
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
                                    <AccordionTrigger className="text-sm hover:no-underline flex-1 p-3 justify-between w-full">
                                        <span className="flex items-center text-left w-full">
                                            <span
                                                role="button"
                                                tabIndex={0}
                                                className="font-mono text-primary font-bold px-1 h-auto text-xs cursor-pointer hover:underline"
                                                onClick={(e) => { e.stopPropagation(); onSeek(parseTimeToSeconds(item.startTime)); }}
                                                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onSeek(parseTimeToSeconds(item.startTime)); }}}
                                            >
                                                {item.startTime?.split('.')[0] || '00:00:00'}
                                            </span>
                                            <span className="whitespace-normal break-keep text-left flex-1 pl-2">{item.subtitle}</span> 
                                        </span>
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
        return <div className="p-5 text-sm text-muted-foreground">콘텐츠 파싱 오류: AI가 생성한 데이터 형식이 올바르지 않습니다.</div>;
    }
};

const ChatView = ({ episode, user }: { episode: Episode; user: any }) => {
    const firestore = useFirestore();
    const [isPending, startTransition] = React.useTransition();
    const [userQuestion, setUserQuestion] = React.useState('');
    const [messages, setMessages] = React.useState<ChatMessage[]>([]);
    const [isLoading, setIsLoading] = React.useState(true);
    const [chatError, setChatError] = React.useState<string | null>(null);
    const isAIAvailable = episode.ai.status === 'completed';

    React.useEffect(() => {
        if (!user || !firestore) return;
        setIsLoading(true);
        setChatError(null);
        
        const q = query(
            collection(firestore, 'users', user.id, 'chats'), 
            where('episodeId', '==', episode.id), 
            orderBy('createdAt', 'asc')
        );
        
        const unsubscribe = onSnapshot(q, 
            (snapshot) => {
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
                setChatError(null);
            },
            (error) => {
                console.error("ChatView snapshot listener error:", error);
                setChatError("채팅 기록을 불러오는 중 오류가 발생했습니다. Firestore 인덱스가 필요할 수 있습니다.");
                setIsLoading(false);
            }
        );
        return unsubscribe;
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
            <ScrollArea className="flex-grow pr-4">
                <div className="space-y-4">
                    {chatError ? (
                        <div className="text-center text-red-500 p-4 bg-red-50 rounded-md">
                            <AlertTriangle className="mx-auto h-8 w-8 mb-2"/>
                            <p className="text-sm font-semibold">{chatError}</p>
                        </div>
                    ) : isLoading ? (
                        <div className="text-center text-muted-foreground p-4">
                            <Loader className="mx-auto h-8 w-8 animate-spin"/>
                        </div>
                    ) : (
                        messages.map(m => (
                            <div key={m.id} className={cn("flex items-end gap-2", m.role === 'user' ? 'justify-end' : 'justify-start')}>
                                {m.role === 'model' && <Bot className="h-8 w-8 p-1 bg-primary text-white rounded-full" />}
                                <p className={cn("text-sm p-3 rounded-lg max-w-[80%]", m.role === 'user' ? 'bg-primary text-white' : 'bg-white border')}>{m.content}</p>
                            </div>
                        ))
                    )}
                    {isPending && <div className="text-xs text-muted-foreground animate-pulse">AI가 답변을 생각 중입니다...</div>}
                </div>
            </ScrollArea>
            <div className="pt-4 border-t flex gap-2">
                <Textarea value={userQuestion} onChange={(e) => setUserQuestion(e.target.value)} disabled={!isAIAvailable || !!chatError} className="h-10 min-h-0 resize-none" placeholder={isAIAvailable ? "비디오에 대해 질문하세요..." : "AI 분석 완료 후 사용 가능합니다."} />
                <Button onClick={handleAskQuestion} disabled={isPending || !isAIAvailable || !!chatError}><Send className="w-4 h-4"/></Button>
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
    const debounceTimer = React.useRef<NodeJS.Timeout | null>(null);

    const handleNoteChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value;
        setNote(val);
        setIsSaving(true);
        if (debounceTimer.current) clearTimeout(debounceTimer.current);
        debounceTimer.current = setTimeout(async () => {
            if (user) await updateBookmarkNote({ userId: user.id, bookmarkId: bookmark.id, note: val });
            setIsSaving(false);
        }, 1500);
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
        <div className="p-4 space-y-4">
            <Button className="w-full bg-primary" onClick={handleAdd}><BookmarkIcon className="w-4 h-4 mr-2"/> 현재 시간 책갈피</Button>
            {isLoading ? <Loader className="mx-auto animate-spin" /> : (
                <ul className="space-y-2">
                    {bookmarks?.map(b => <BookmarkItem key={b.id} bookmark={b} onSeek={(t) => { if(videoElement) videoElement.currentTime = t; }} onDelete={(id) => deleteBookmark(user.id, id)} />)}
                    {bookmarks?.length === 0 && <p className="text-center text-xs text-muted-foreground pt-4">저장된 책갈피가 없습니다.</p>}
                </ul>
            )}
        </div>
    );
};

const PlayerStatusOverlay = ({ playerState, playerMessage }: { playerState: PlayerState, playerMessage: string | null }) => {
    
    let content: React.ReactNode = null;

    switch (playerState) {
        case 'idle':
        case 'playing':
        case 'paused':
        case 'ready':
             return null;
        case 'requesting-key':
        case 'downloading':
        case 'decrypting':
             return null;
        case 'recovering':
            content = (
                <>
                    <RotateCcw className="w-12 h-12 animate-spin mb-4"/>
                    <p className="font-bold">연결이 불안정하여 복구 중입니다...</p>
                    <p className="text-sm text-muted-foreground mt-1">{playerMessage}</p>
                </>
            );
            break;
        case 'error-fatal':
        case 'error-retryable':
        case 'license-expired':
             content = (
                <>
                    <AlertTriangle className="w-12 h-12 text-destructive mb-4"/>
                    <p className="font-semibold">{playerState === 'license-expired' ? '오프라인 라이선스 만료' : '재생 오류'}</p>
                    <p className="text-sm text-muted-foreground mt-1">{playerMessage}</p>
                </>
            );
            break;
    }
    
    return (
        <div className="absolute inset-0 bg-black/90 z-50 flex flex-col items-center justify-center text-white p-6 text-center">
            {content}
        </div>
    );
};

const Watermark = ({ seed }: { seed: string | null }) => {
    const [positions, setPositions] = React.useState<{ top: string; left: string }[]>([]);
  
    React.useEffect(() => {
      if (seed) {
        const newPositions = Array.from({ length: 5 }).map(() => ({
          top: `${Math.random() * 80 + 10}%`,
          left: `${Math.random() * 80 + 10}%`,
        }));
        setPositions(newPositions);
      }
    }, [seed]);
  
    if (!seed) return null;
  
    return (
      <div className="absolute inset-0 pointer-events-none overflow-hidden z-10">
        {positions.map((pos, i) => (
          <span
            key={i}
            className="absolute text-white/10 text-xs"
            style={{ ...pos, transform: 'rotate(-15deg)' }}
          >
            {seed}
          </span>
        ))}
      </div>
    );
  };

interface VideoPlayerDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  episode: Episode;
  instructor?: Instructor | null;
  offlineVideoData?: OfflineVideoData;
}


// ========= MAIN COMPONENT =========

export default function VideoPlayerDialog({ isOpen, onOpenChange, episode, instructor, offlineVideoData }: VideoPlayerDialogProps) {
    const { user, authUser } = useUser();
    const { toast } = useToast();
    const firestore = useFirestore();
    const [playerState, setPlayerState] = React.useState<PlayerState>('idle');
    const [playerMessage, setPlayerMessage] = React.useState<string | null>(null);
    
    const [sessionId, setSessionId] = React.useState<string | null>(null);
    const [watermarkSeed, setWatermarkSeed] = React.useState<string | null>(null);
    const [downloadState, setDownloadState] = React.useState<DownloadState>('idle');
    const [downloadDisabledReason, setDownloadDisabledReason] = React.useState<string | undefined>();

    const videoRef = React.useRef<HTMLVideoElement>(null);
    const workerRef = React.useRef<Worker | null>(null);
    const mediaSourceRef = React.useRef<MediaSource | null>(null);
    const sourceBufferRef = React.useRef<SourceBuffer | null>(null);
    const activeRequestIdRef = React.useRef<string | null>(null);
    const segmentQueueRef = React.useRef<string[]>([]);
    const currentSegmentIndexRef = React.useRef(0);
    const decryptionKeyRef = React.useRef<string | null>(null);
    const heartbeatIntervalRef = React.useRef<NodeJS.Timeout | null>(null);
    
    const courseRef = useMemoFirebase(() => (firestore ? doc(firestore, 'courses', episode.courseId) : null), [firestore, episode.courseId]);
    const { data: course } = useDoc<Course>(courseRef);

    const handleSeek = (timeInSeconds: number) => {
        const video = videoRef.current;
        if (video) {
            video.currentTime = timeInSeconds;
            video.play().catch(() => {});
            toast({ title: "이동 완료", description: `${formatDuration(timeInSeconds)} 지점입니다.` });
        }
    };

    const handleDownload = React.useCallback(async () => {
        if (!authUser || !course) {
            setDownloadDisabledReason('사용자 또는 강좌 정보를 불러올 수 없습니다.');
            setDownloadState('forbidden');
            return;
        }

        setDownloadState('checking');
        try {
            const token = await authUser.getIdToken();
            const res = await fetch('/api/offline-license', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`},
                body: JSON.stringify({ videoId: episode.id, deviceId: 'web-offline-v1' })
            });

            if (!res.ok) {
                const { error } = await res.json();
                throw new Error(error || '라이선스 발급에 실패했습니다.');
            }
            const license: OfflineLicense = await res.json();
            
            setDownloadState('downloading');
            const manifestRes = await getSignedUrlAction(token, episode.id, episode.storage.manifestPath);
            if (manifestRes.error) throw new Error(manifestRes.error);
            
            const manifestData: VideoManifest = await (await fetch(manifestRes.signedUrl!)).json();

            setDownloadState('saving');
            const dataToSave: OfflineVideoData = {
                episode,
                courseName: course.name,
                downloadedAt: new Date(),
                license,
                manifest: manifestData,
                segments: new Map() // Segments will be fetched and added by saveVideo
            };
            await saveVideo(dataToSave);

            setDownloadState('completed');
            toast({ title: '저장 완료', description: `'${episode.title}'을(를) 오프라인으로 저장했습니다.` });

        } catch (error: any) {
            console.error("Download failed:", error);
            setDownloadState('error');
            setDownloadDisabledReason(error.message);
            toast({ variant: 'destructive', title: '저장 실패', description: error.message });
        }
    }, [authUser, course, episode, toast]);

    const getSignedUrl = async (token: string, videoId: string, fileName: string) => {
        logStage('STAGE_3_SEGMENT_URL_REQUEST', 'START', `Path: ${fileName}`);
        const { signedUrl, error } = await getSignedUrlAction(token, videoId, fileName);
        if (error || !signedUrl) {
            logStage('STAGE_3_SEGMENT_URL_REQUEST', 'FAIL', `Error: ${error}`);
            throw new Error(`URL 요청 실패 (${fileName}): ${error || 'Unknown error'}`);
        }
        logStage('STAGE_3_SEGMENT_URL_REQUEST', 'SUCCESS');
        return signedUrl;
    };
    
    const cleanup = React.useCallback(() => {
        if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
        if (sessionId) {
            endPlaySession(sessionId);
        }
        workerRef.current?.terminate();
        workerRef.current = null;
        activeRequestIdRef.current = null;
        decryptionKeyRef.current = null;
        
        const video = videoRef.current;
        if (video && video.src) {
             try {
                URL.revokeObjectURL(video.src);
                video.removeAttribute('src');
                video.load();
            } catch (e) {}
        }
        mediaSourceRef.current = null;
        sourceBufferRef.current = null;
        setPlayerState('idle');
    }, [sessionId]);

    const startPlayback = React.useCallback(async (requestId: string) => {
        cleanup(); 
        activeRequestIdRef.current = requestId;

        if (episode.status?.pipeline === 'failed') {
            setPlayerState('error-fatal');
            setPlayerMessage(episode.status.error?.message || '비디오 처리 중 오류 발생.');
            return;
        }

        if (!episode.storage.manifestPath || !episode.encryption?.keyId) {
            setPlayerState('error-fatal');
            setPlayerMessage('필수 재생 정보(manifest, keyId)가 누락되었습니다.');
            return;
        }
        
        const ms = new MediaSource();
        mediaSourceRef.current = ms;
        
        ms.addEventListener('sourceopen', () => console.log('[MSE] Event: sourceopen'));
        ms.addEventListener('sourceended', () => console.log('[MSE] Event: sourceended'));
        ms.addEventListener('sourceclose', () => console.log('[MSE] Event: sourceclose'));

        if(videoRef.current) {
            videoRef.current.addEventListener('waiting', () => console.log('[MSE] Video event: waiting (buffering)'));
            videoRef.current.addEventListener('stalled', () => console.log('[MSE] Video event: stalled (network issue)'));
        }
        
        workerRef.current = new Worker(new URL('../../workers/crypto.worker.ts', import.meta.url));

        const fetchAndProcessNextSegment = async () => {
            const sb = sourceBufferRef.current;
            if (!sb || sb.updating) {
                return;
            }

            const segmentIndex = currentSegmentIndexRef.current;
            if (segmentIndex >= segmentQueueRef.current.length) {
                if (ms.readyState === 'open' && !sb.updating) {
                    try {
                        ms.endOfStream();
                    } catch (e) { console.warn("Error calling endOfStream:", e); }
                }
                return;
            }

            try {
                const segmentPath = segmentQueueRef.current[segmentIndex];
                
                let segmentBuffer: ArrayBuffer;
                if(offlineVideoData) {
                    segmentBuffer = offlineVideoData.segments.get(segmentPath)!;
                    if(!segmentBuffer) throw new Error(`오프라인 세그먼트를 찾을 수 없습니다: ${segmentPath}`);
                } else {
                    const token = await authUser?.getIdToken();
                    if (!token) throw new Error("Authentication token not available.");

                    logStage('STAGE_4_SEGMENT_DOWNLOAD', 'START', `Path: ${segmentPath}`);
                    const url = await getSignedUrl(token, episode.id, segmentPath);
                    const res = await fetch(url);
                    if (!res.ok) throw new Error(`세그먼트 다운로드 실패: ${res.status} ${res.statusText}`);
                    segmentBuffer = await res.arrayBuffer();
                    logStage('STAGE_4_SEGMENT_DOWNLOAD', 'SUCCESS');
                }
                
                logStage('STAGE_5_WORKER_DECRYPT', 'START', `Segment index: ${segmentIndex}`);
                workerRef.current?.postMessage({
                  type: 'DECRYPT_SEGMENT',
                  payload: { 
                      requestId: `${requestId}-${segmentIndex}`, 
                      encryptedSegment: segmentBuffer, 
                      derivedKeyB64: decryptionKeyRef.current,
                      segmentPath: segmentPath,
                      encryption: episode.encryption
                  }
                });
            } catch (e: any) {
                logStage('STAGE_4_SEGMENT_DOWNLOAD', 'FAIL', e.message);
                setPlayerState('error-fatal');
                setPlayerMessage(`세그먼트 로딩 실패: ${e.message}`);
                return;
            }
        };

        workerRef.current.onmessage = (event: MessageEvent<CryptoWorkerResponse>) => {
            const { type, payload } = event.data;
            if (type === 'DECRYPT_SUCCESS') {
                logStage('STAGE_5_WORKER_DECRYPT', 'SUCCESS');
                const { decryptedSegment } = payload;
                const sb = sourceBufferRef.current;
                
                const append = () => {
                    if (sb?.updating) {
                        sb.addEventListener('updateend', append, { once: true });
                        return;
                    }
                    try {
                        logStage('STAGE_6_MSE_APPEND', 'START');
                        sb?.appendBuffer(decryptedSegment);
                        logStage('STAGE_6_MSE_APPEND', 'SUCCESS');
                    } catch (e: any) {
                        logStage('STAGE_6_MSE_APPEND', 'FAIL', e.message);
                        setPlayerState('error-fatal');
                        setPlayerMessage(`미디어 버퍼 추가 실패: ${e.message}`);
                    }
                }
                append();

            } else {
                logStage('STAGE_5_WORKER_DECRYPT', 'FAIL', payload.message);
                setPlayerState('error-fatal');
                setPlayerMessage(`복호화 실패: ${payload.message}`);
            }
        };
        
        ms.addEventListener('sourceopen', async () => {
            try {
                let manifest: VideoManifest;
                
                if (offlineVideoData) {
                    if (new Date() > new Date(offlineVideoData.license.expiresAt)) {
                        setPlayerState('license-expired');
                        setPlayerMessage('오프라인 라이선스가 만료되었습니다.');
                        throw new Error("오프라인 라이선스가 만료되었습니다.");
                    }
                    manifest = offlineVideoData.manifest;
                    decryptionKeyRef.current = offlineVideoData.license.offlineDerivedKey;
                    setWatermarkSeed(offlineVideoData.license.watermarkSeed);
                } else {
                    if (!authUser) throw new Error("로그인이 필요합니다.");
                    const token = await authUser.getIdToken();

                    logStage('STAGE_1_PLAY_SESSION', 'START');
                    const sessionRes = await fetch('/api/play-session', {
                        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                        body: JSON.stringify({ videoId: episode.id, deviceId: 'web-online' })
                    });
                    if (!sessionRes.ok) {
                        const errorData = await sessionRes.json();
                        throw new Error(errorData.message || `보안 세션 시작 실패: ${sessionRes.status}`);
                    }
                    const sessionData = await sessionRes.json();
                    decryptionKeyRef.current = sessionData.derivedKeyB64;
                    setSessionId(sessionData.sessionId);
                    setWatermarkSeed(sessionData.watermarkSeed);
                    logStage('STAGE_1_PLAY_SESSION', 'SUCCESS', `Session ID: ${sessionData.sessionId}`);
                    
                    logStage('STAGE_2_MANIFEST_FETCH', 'START');
                    const manifestUrl = await getSignedUrl(token, episode.id, episode.storage.manifestPath!);
                    const manifestRes = await fetch(manifestUrl);
                    manifest = await manifestRes.json();
                    logStage('STAGE_2_MANIFEST_FETCH', 'SUCCESS');
                }

                if (!decryptionKeyRef.current) throw new Error("마스터 키가 없습니다.");

                const mimeCodec = manifest.codec;
                if (!MediaSource.isTypeSupported(mimeCodec)) throw new Error(`코덱을 지원하지 않습니다: ${mimeCodec}`);
                
                const sourceBuffer = ms.addSourceBuffer(mimeCodec);
                sourceBufferRef.current = sourceBuffer;
                
                sourceBuffer.addEventListener('update', () => console.log('[MSE] SourceBuffer event: update'));
                sourceBuffer.addEventListener('updateend', () => console.log('[MSE] SourceBuffer event: updateend'));
                sourceBuffer.addEventListener('error', (e) => console.error('[MSE] SourceBuffer event: error', e));
                sourceBuffer.addEventListener('abort', (e) => console.log('[MSE] SourceBuffer event: abort', e));

                if (manifest.duration && isFinite(manifest.duration)) {
                    try { ms.duration = manifest.duration; } catch (e) { console.warn("Could not set MediaSource duration.", e); }
                }
                
                sourceBuffer.addEventListener('updateend', () => {
                    currentSegmentIndexRef.current++;
                    fetchAndProcessNextSegment();
                });
                
                segmentQueueRef.current = [manifest.init, ...manifest.segments.map(s => s.path)];
                currentSegmentIndexRef.current = 0;

                fetchAndProcessNextSegment();

            } catch (e: any) {
                console.error("Playback setup failed:", e);
                setPlayerState('error-fatal');
                setPlayerMessage(e.message);
            }
        });
        
        if (videoRef.current) {
            videoRef.current.src = URL.createObjectURL(ms);
            videoRef.current.play().then(() => {
                logStage('STAGE_7_VIDEO_PLAY', 'SUCCESS');
            }).catch(e => {
                logStage('STAGE_7_VIDEO_PLAY', 'FAIL', `Autoplay prevented: ${(e as Error).message}`);
            });
        }
    }, [cleanup, offlineVideoData, authUser, episode]);

    React.useEffect(() => {
        if (isOpen && videoRef.current) {
            const initialRequestId = uuidv4();
            startPlayback(initialRequestId);
        } else if (!isOpen) {
            cleanup();
        }

        const handleBeforeUnload = () => {
            if (sessionId) {
                endPlaySession(sessionId);
            }
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        
        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload);
            cleanup();
        };
    }, [isOpen, startPlayback, cleanup, sessionId]);

    React.useEffect(() => {
        if (sessionId) {
            heartbeatIntervalRef.current = setInterval(() => {
                heartbeatPlaySession(sessionId);
            }, 30 * 1000); // 30 seconds
        }
        return () => {
            if (heartbeatIntervalRef.current) {
                clearInterval(heartbeatIntervalRef.current);
            }
        };
    }, [sessionId]);
    
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
       <DialogContent className="max-w-none w-full h-full p-0 flex flex-col border-0 md:max-w-[96vw] md:h-[92vh] md:rounded-2xl overflow-hidden shadow-2xl">
         <div className="flex flex-row h-12 items-center justify-between border-b bg-white pl-4 pr-12 flex-shrink-0 relative">
            <div className="flex-1 min-w-0">
                <DialogTitle className="text-base font-bold truncate">
                    {course?.name} <ChevronRight className="inline w-4 h-4 mx-1 text-muted-foreground"/> {episode.title}
                </DialogTitle>
                <DialogDescription className="sr-only">비디오 재생 및 관련 정보 다이얼로그</DialogDescription>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                 {!offlineVideoData && (
                    <DownloadButton 
                        downloadState={downloadState} 
                        onDownload={handleDownload}
                        reasonDisabled={downloadDisabledReason}
                    />
                )}
            </div>
            <DialogClose className="absolute right-3 top-1/2 -translate-y-1/2 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
                <X className="h-4 w-4" />
                <span className="sr-only">Close</span>
            </DialogClose>
        </div>
        
        <div className="flex-1 flex flex-col md:grid md:grid-cols-10 bg-muted/30 min-h-0">
            <div className="col-span-10 md:col-span-7 bg-black relative flex items-center justify-center aspect-video md:aspect-auto md:min-h-0">
                <PlayerStatusOverlay playerState={playerState} playerMessage={playerMessage} />
                <video ref={videoRef} className="w-full h-full" autoPlay playsInline controls />
                <Watermark seed={watermarkSeed} />
            </div>

            <div className="col-span-10 md:col-span-3 bg-white border-l flex flex-col min-h-0 flex-1 md:flex-auto">
                <Tabs defaultValue="syllabus" className="flex-1 flex flex-col min-h-0">
                    <TabsList className="grid w-full grid-cols-4 rounded-none border-b h-12 bg-gray-50/50 flex-shrink-0">
                        <TabsTrigger value="syllabus" className="text-xs">강의목차</TabsTrigger>
                        <TabsTrigger value="search" className="text-xs">강의검색</TabsTrigger>
                        <TabsTrigger value="textbook" className="text-xs">교재정보</TabsTrigger>
                        <TabsTrigger value="bookmark" className="text-xs">책갈피</TabsTrigger>
                    </TabsList>
                    <div className="flex-1 min-h-0">
                        <TabsContent value="syllabus" className="mt-0 h-full">
                            <ScrollArea className="h-full">
                                <SyllabusView 
                                    episode={episode} 
                                    onSeek={handleSeek}
                                    offlineVideoData={offlineVideoData}
                                />
                            </ScrollArea>
                        </TabsContent>
                        <TabsContent value="search" className="mt-0 h-full">{user ? <ChatView episode={episode} user={user}/> : <p className="p-10 text-center text-xs">로그인이 필요합니다.</p>}</TabsContent>
                        <TabsContent value="textbook" className="mt-0 h-full"><TextbookView /></TabsContent>
                        <TabsContent value="bookmark" className="mt-0 h-full">{user ? <BookmarkView episode={episode} user={user} videoElement={videoRef.current}/> : <p className="p-10 text-center text-xs">로그인이 필요합니다.</p>}</TabsContent>
                    </div>
                </Tabs>
            </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
