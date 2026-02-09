
'use client';

import type { Episode, Instructor, Course, User, Bookmark, OfflineVideoData, CryptoWorkerRequest, CryptoWorkerResponse } from '@/lib/types';
import React from 'react';
import { Button } from '../ui/button';
import { useUser, useFirestore, useDoc, useMemoFirebase, useCollection, useAuth } from '@/firebase';
import { logEpisodeView } from '@/lib/actions/log-view';
import { Textarea } from '../ui/textarea';
import { Send, Bot, User as UserIcon, X, Loader, FileText, Clock, ChevronRight, Bookmark as BookmarkIcon, Trash2, Download, AlertTriangle, CheckCircle } from 'lucide-react';
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
import Link from 'next/link';
import { Skeleton } from '../ui/skeleton';
import { addBookmark, deleteBookmark, updateBookmarkNote } from '@/lib/actions/bookmark-actions';
import { Input } from '../ui/input';
import { saveVideo } from '@/lib/offline-db';
import { useDebugLogDispatch } from '@/context/debug-log-context';


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
  instructor?: Instructor | null;
  offlineVideoData?: OfflineVideoData | null;
}

// ========= SUB-COMPONENTS =========

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

const SyllabusView = ({ episode, onSeek }: { episode: Episode, onSeek: (timeInSeconds: number) => void; }) => {
    // New, more detailed status handling
    if (episode.aiProcessingStatus === 'failed') {
        return (
            <div className="flex-grow flex flex-col items-center justify-center text-center p-4">
                <AlertTriangle className="h-12 w-12 text-destructive" />
                <p className="font-semibold mt-4">AI 분석 실패</p>
                <p className="text-sm text-muted-foreground mt-2 break-keep">
                    강의 요약 및 타임라인을 생성하지 못했습니다.
                </p>
                {episode.aiProcessingError && (
                    <p className="text-xs text-muted-foreground mt-2 break-keep max-w-sm p-2 bg-destructive/10 rounded-md">
                        오류 원인: {episode.aiProcessingError}
                    </p>
                )}
                 <p className="text-xs text-muted-foreground mt-4 break-keep">
                    관리자 페이지에서 재분석을 시도할 수 있습니다.
                </p>
            </div>
        );
    }
    
    if (episode.aiProcessingStatus !== 'completed' || !episode.aiGeneratedContent) {
        return (
            <div className="flex-grow flex flex-col items-center justify-center text-center p-4">
                <Loader className="h-12 w-12 text-muted-foreground animate-spin" />
                <p className="text-sm text-muted-foreground mt-4 break-keep">AI가 강의 내용을 분석하고 있습니다.<br/>잠시 후 다시 시도해주세요.</p>
            </div>
        );
    }
    
    try {
        const data = JSON.parse(episode.aiGeneratedContent);
        
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
                                    <AccordionTrigger 
                                        className="text-sm hover:no-underline text-left px-3 py-2" 
                                        onClick={() => onSeek(parseTimeToSeconds(item.startTime))}
                                    >
                                        <div className="flex items-center gap-2 min-w-0">
                                            <span className="font-mono text-primary font-bold">{item.startTime?.split('.')[0] || '00:00:00'}</span>
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
        return <div className="p-5 text-sm text-muted-foreground">콘텐츠 파싱 오류: AI가 생성한 데이터 형식이 올바르지 않습니다.</div>;
    }
};

const ChatView = ({ episode, user }: { episode: Episode; user: any }) => {
    const firestore = useFirestore();
    const [isPending, startTransition] = React.useTransition();
    const [userQuestion, setUserQuestion] = React.useState('');
    const [messages, setMessages] = React.useState<ChatMessage[]>([]);
    const [isLoading, setIsLoading] = React.useState(true);
    const isAIAvailable = episode.aiProcessingStatus === 'completed';

    React.useEffect(() => {
        if (!user || !firestore) return;
        const q = query(collection(firestore, 'users', user.id, 'chats'), where('episodeId', '==', episode.id), orderBy('createdAt', 'asc'));
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
        });
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
    
    const episodeStatus = episode.status || { processing: 'pending', playable: false };

    if (episodeStatus.processing !== 'completed') {
        const statusText = episodeStatus.processing === 'failed' ? '영상 처리 실패' : '영상 처리 중...';
        const Icon = episodeStatus.processing === 'failed' ? AlertTriangle : Loader;
        const iconColor = episodeStatus.processing === 'failed' ? 'text-destructive' : '';
        
        return (
            <div className="absolute inset-0 bg-black/90 z-50 flex flex-col items-center justify-center text-white p-6 text-center">
                <Icon className={cn("w-12 h-12 mb-4", episodeStatus.processing !== 'failed' && 'animate-spin', iconColor)} />
                <p className="font-bold">{statusText}</p>
                {episodeStatus.error && <p className="text-xs text-muted-foreground mt-2 max-w-sm">{episodeStatus.error}</p>}
            </div>
        );
    }
    
    return null;
}

// ========= MAIN COMPONENT =========

export default function VideoPlayerDialog({ isOpen, onOpenChange, episode, instructor, offlineVideoData }: VideoPlayerDialogProps) {
  const { user, authUser } = useUser();
  const { toast } = useToast();
  const firestore = useFirestore();
  const [isLoading, setIsLoading] = React.useState(true);
  const [playerError, setPlayerError] = React.useState<string | null>(null);
  const [watermarkSeed, setWatermarkSeed] = React.useState<string | null>(null);
  const [downloadState, setDownloadState] = React.useState<'idle' | 'downloading' | 'saving' | 'completed' | 'error'>('idle');

  const videoRef = React.useRef<HTMLVideoElement>(null);
  const workerRef = React.useRef<Worker | null>(null);
  
  const { addLog } = useDebugLogDispatch();

  const courseRef = useMemoFirebase(() => (firestore ? doc(firestore, 'courses', episode.courseId) : null), [firestore, episode.courseId]);
  const { data: course } = useDoc<Course>(courseRef);

  React.useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement) return;

    const handleError = (e: Event) => {
        const error = (e.target as HTMLVideoElement).error;
        if (!error) return;

        let message = '';
        switch (error.code) {
            case error.MEDIA_ERR_ABORTED: message = '사용자에 의해 비디오 로딩이 중단되었습니다.'; break;
            case error.MEDIA_ERR_NETWORK: message = '네트워크 오류로 인해 비디오 다운로드에 실패했습니다.'; break;
            case error.MEDIA_ERR_DECODE: message = '비디오에 문제가 있거나, 브라우저에서 지원하지 않는 형식으로 인해 디코딩에 실패했습니다.'; break;
            case error.MEDIA_ERR_SRC_NOT_SUPPORTED: message = '비디오를 찾을 수 없거나 형식을 지원하지 않습니다. (소스 문제)'; break;
            default: message = `알 수 없는 비디오 재생 오류가 발생했습니다. (코드: ${error.code})`;
        }
        addLog('ERROR', `비디오 태그 오류: ${message}`);
        setPlayerError(message);
    };

    videoElement.addEventListener('error', handleError);
    return () => { videoElement.removeEventListener('error', handleError); };
  }, [addLog, isOpen]);

  const handleSeek = (timeInSeconds: number) => {
    if (videoRef.current) {
        videoRef.current.currentTime = timeInSeconds;
        videoRef.current.play().catch(() => {});
        toast({ title: "이동 완료", description: `${formatDuration(timeInSeconds)} 지점입니다.` });
    }
  };

  const handleDownload = async () => {
    if (!authUser || !course || !episode) {
        toast({ variant: 'destructive', title: '오류', description: '다운로드에 필요한 정보가 부족합니다.' });
        return;
    }
    setDownloadState('downloading');
    try {
        const token = await authUser.getIdToken();
        
        const licenseRes = await fetch('/api/offline-license', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ videoId: episode.id, deviceId: 'web-offline' }),
        });
        if (!licenseRes.ok) throw new Error(`오프라인 라이선스 발급 실패: ${await licenseRes.text()}`);
        const license = await licenseRes.json();
        
        const urlRes = await fetch('/api/video-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ videoId: episode.id }),
        });
        if (!urlRes.ok) throw new Error(`비디오 URL 요청 실패: ${await urlRes.text()}`);
        const { signedUrl } = await urlRes.json();
        
        const encryptedRes = await fetch(signedUrl);
        const encryptedVideo = await encryptedRes.arrayBuffer();

        setDownloadState('saving');
        
        await saveVideo({
            episode: episode,
            courseName: course.name,
            downloadedAt: new Date(),
            expiresAt: new Date(license.expiresAt),
            encryptedVideo,
            license: {
                offlineDerivedKey: license.offlineDerivedKey,
                watermarkSeed: license.watermarkSeed,
            },
        });
        
        setDownloadState('completed');
        toast({ title: '다운로드 완료', description: `'${episode.title}' 영상이 다운로드함에 저장되었습니다.` });

    } catch (error: any) {
        setDownloadState('error');
        toast({ variant: 'destructive', title: '다운로드 실패', description: error.message });
        console.error("Download Error:", error);
    }
  };

  React.useEffect(() => {
    workerRef.current = new Worker(new URL('../../workers/crypto.worker.ts', import.meta.url));
    let mediaSource: MediaSource | null = new MediaSource();
    let sourceBuffer: SourceBuffer | null = null;
    let abortController = new AbortController();

    const worker = workerRef.current;

    const setupPlayback = async () => {
        if (!isOpen) return;

        setIsLoading(true);
        setPlayerError(null);
        setWatermarkSeed(null);
        addLog('INFO', '▶️ 재생 준비 시작...');

        if (videoRef.current && mediaSource) {
            videoRef.current.src = URL.createObjectURL(mediaSource);
        }
        
        const handleSourceOpen = async () => {
            if (!mediaSource) return;
            mediaSource.removeEventListener('sourceopen', handleSourceOpen);
            try {
                let derivedKeyB64: string;
                let encryptedBuffer: ArrayBuffer;
                let seed: string | null = null;

                if (offlineVideoData) {
                    addLog('INFO', '📀 오프라인 데이터로 재생합니다.');
                    encryptedBuffer = offlineVideoData.encryptedVideo;
                    derivedKeyB64 = offlineVideoData.license.offlineDerivedKey;
                    seed = offlineVideoData.license.watermarkSeed;
                } else {
                    if (!authUser) throw new Error("로그인이 필요합니다.");
                    addLog('INFO', '☁️ 온라인 스트리밍을 시작합니다.');

                    const token = await authUser.getIdToken();
                    addLog('SUCCESS', '1. 인증 토큰 획득 완료.');

                    const sessionRes = await fetch('/api/play-session', {
                        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                        body: JSON.stringify({ videoId: episode.id, deviceId: 'web-online' }), signal: abortController.signal
                    });
                    if (!sessionRes.ok) throw new Error(`보안 세션 시작 실패 (${sessionRes.status}): ${await sessionRes.text()}`);
                    const sessionData = await sessionRes.json();
                    derivedKeyB64 = sessionData.derivedKey;
                    seed = sessionData.watermarkSeed;
                    addLog('SUCCESS', '2. 보안 세션 수립 완료 (임시 키 수신).');

                    const urlRes = await fetch('/api/video-url', {
                        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                        body: JSON.stringify({ videoId: episode.id }), signal: abortController.signal
                    });
                    if (!urlRes.ok) throw new Error(`비디오 URL 요청 실패 (${urlRes.status}): ${await urlRes.text()}`);
                    const { signedUrl } = await urlRes.json();
                    addLog('SUCCESS', '3. 서명된 URL 획득 완료.');

                    const encryptedRes = await fetch(signedUrl, { signal: abortController.signal });
                    if (!encryptedRes.ok) throw new Error(`비디오 파일 다운로드 실패 (상태: ${encryptedRes.status})`);
                    encryptedBuffer = await encryptedRes.arrayBuffer();
                    addLog('SUCCESS', `4. 다운로드 완료 (${(encryptedBuffer.byteLength / 1024 / 1024).toFixed(2)} MB).`);
                }
                
                if (!isOpen) return;

                setWatermarkSeed(seed);

                worker.onmessage = (event: MessageEvent<CryptoWorkerResponse>) => {
                    if (event.data.type === 'DECRYPT_SUCCESS') {
                        const decryptedData = event.data.payload as ArrayBuffer;
                        addLog('SUCCESS', '5. 복호화 성공! 미디어 버퍼에 데이터 추가 시작...');
                        if (mediaSource?.readyState === 'open') {
                             try {
                                sourceBuffer = mediaSource.addSourceBuffer('video/mp4; codecs="avc1.42E01E, mp4a.40.2"');
                                sourceBuffer.addEventListener('updateend', () => {
                                    if (mediaSource?.readyState === 'open' && !sourceBuffer?.updating) {
                                        try { mediaSource.endOfStream(); } catch(e) {}
                                    }
                                });
                                sourceBuffer.appendBuffer(decryptedData);
                                addLog('SUCCESS', '🎉 재생 준비 완료!');
                            } catch (e: any) {
                                addLog('ERROR', `미디어 버퍼 오류: ${e.message}`);
                                setPlayerError(`미디어 버퍼 오류: ${e.message}`);
                            }
                        }
                    } else { // DECRYPT_ERROR
                        const errorPayload = event.data.payload as { message: string };
                        addLog('ERROR', `워커 복호화 실패: ${errorPayload.message}`);
                        setPlayerError(errorPayload.message);
                    }
                    setIsLoading(false);
                };

                const workerRequest: CryptoWorkerRequest = {
                    type: 'DECRYPT',
                    payload: { encryptedBuffer, derivedKeyB64, encryption: episode.encryption }
                };
                addLog('INFO', '5. 웹 워커로 복호화 요청 전송...');
                worker.postMessage(workerRequest, [encryptedBuffer]);
                
            } catch (error: any) {
                if (isOpen) {
                    addLog('ERROR', error.message);
                    setPlayerError(error.message || "비디오를 재생할 수 없습니다.");
                    setIsLoading(false);
                }
            }
        };

        if (mediaSource) {
            mediaSource.addEventListener('sourceopen', handleSourceOpen);
        }
    };

    if (isOpen) {
        if (offlineVideoData || (episode.status?.processing === 'completed' && episode.status?.playable)) {
            setupPlayback();
        } else {
            setIsLoading(false);
        }
    }
    
    return () => { 
        worker?.terminate();
        abortController.abort("Component unmounted");
        if (mediaSource && videoRef.current?.src) {
            URL.revokeObjectURL(videoRef.current.src);
            mediaSource = null;
        }
    };
  }, [isOpen, episode, offlineVideoData, authUser, addLog]);

  const DownloadButton = () => {
    switch (downloadState) {
        case 'downloading': return <Button variant="ghost" size="icon" disabled><Loader className="h-4 w-4 animate-spin"/></Button>;
        case 'saving': return <Button variant="ghost" size="icon" disabled><Loader className="h-4 w-4 animate-spin"/></Button>;
        case 'completed': return <Button variant="ghost" size="icon" disabled><CheckCircle className="h-4 w-4 text-green-500"/></Button>;
        case 'error': return <Button variant="ghost" size="icon" onClick={handleDownload}><AlertTriangle className="h-4 w-4 text-destructive"/></Button>;
        default: return <Button variant="ghost" size="icon" onClick={handleDownload}><Download className="h-4 w-4"/></Button>;
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
       <DialogContent className="max-w-none w-full h-full p-0 flex flex-col border-0 md:max-w-[96vw] md:h-[92vh] md:rounded-2xl overflow-hidden shadow-2xl">
         <div className="flex h-12 items-center justify-between border-b bg-white pl-4 pr-12 flex-shrink-0 relative">
            <div className="flex-1 min-w-0">
                <DialogTitle className="text-base font-bold truncate">
                    {course?.name} <ChevronRight className="inline w-4 h-4 mx-1 text-muted-foreground"/> {episode.title}
                </DialogTitle>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                {!offlineVideoData && <DownloadButton />}
            </div>
             <DialogClose className="absolute right-4 top-1/2 -translate-y-1/2 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
                <X className="h-4 w-4" />
                <span className="sr-only">Close</span>
            </DialogClose>
        </div>
        
        <div className="flex-1 flex flex-col md:grid md:grid-cols-10 bg-muted/30 min-h-0">
            <div className="col-span-10 md:col-span-7 bg-black relative flex items-center justify-center aspect-video md:aspect-auto md:min-h-0">
                <PlayerStatusOverlay episode={episode} isLoading={isLoading} playerError={playerError} />
                <video ref={videoRef} className="w-full h-full" autoPlay playsInline controls/>
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
                            <ScrollArea className="h-full"><SyllabusView episode={episode} onSeek={handleSeek}/></ScrollArea>
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
