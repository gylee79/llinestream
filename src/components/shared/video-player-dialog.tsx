'use client';

import type { Episode, Instructor, Course, User, Bookmark } from '@/lib/types';
import React, { useEffect, useRef, useState, useTransition, useCallback, useMemo } from 'react';
import { Button } from '../ui/button';
import { useUser, useFirestore, useDoc, useMemoFirebase, useCollection } from '@/firebase';
import { logEpisodeView } from '@/lib/actions/log-view';
import { Textarea } from '../ui/textarea';
import { Send, Bot, User as UserIcon, X, Loader, FileText, Clock, ChevronRight, Bookmark as BookmarkIcon, Trash2 } from 'lucide-react';
import { ScrollArea } from '../ui/scroll-area';
import { askVideoTutor } from '@/ai/flows/video-tutor-flow';
import { cn } from '@/lib/utils';
import { v4 as uuidv4 } from 'uuid';
import { getPublicUrl } from '@/lib/utils';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../ui/accordion';
import { collection, query, where, orderBy, onSnapshot, Timestamp as FirebaseTimestamp, doc, addDoc, deleteDoc } from 'firebase/firestore';
import { toDisplayDate } from '@/lib/date-helpers';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogClose } from '@/components/ui/dialog';
import Image from 'next/image';
import { firebaseConfig } from '@/firebase/config';
import { useToast } from '@/hooks/use-toast';
import { Card } from '../ui/card';

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
            <div className="flex-grow flex flex-col items-center justify-center text-center">
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
            <ScrollArea className="h-full w-full">
                <div className="space-y-4">
                    <div className="space-y-1">
                        <h4 className="font-semibold text-base">강의 요약</h4>
                        <p className="text-sm text-foreground whitespace-pre-line break-words">{data.summary || '요약이 없습니다.'}</p>
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
                                                <p className="truncate">{item.subtitle}</p> 
                                            </div>
                                        </AccordionTrigger>
                                        <AccordionContent className="px-3 pb-3">
                                            <p className="text-sm text-foreground whitespace-pre-line break-words">{item.description}</p>
                                        </AccordionContent>
                                    </AccordionItem>
                                ))}
                            </Accordion>
                        </div>
                    )}
                </div>
            </ScrollArea>
        )
    } catch(e) {
        return (
            <ScrollArea className="h-full w-full">
                <p className="text-sm text-muted-foreground whitespace-pre-line break-words">{episode.aiGeneratedContent}</p>
            </ScrollArea>
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
            collection(firestore, 'chat_logs'), 
            where('userId', '==', user.id),
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
                await askVideoTutor({ episodeId: episode.id, question: questionContent, userId: user.id });
            } catch (error) {
                setMessages(prev => [...prev, { id: uuidv4(), role: 'model', content: "죄송합니다, 답변 생성 중 오류가 발생했습니다.", createdAt: new Date() }]);
            }
        });
    };

    return (
        <div className="flex-1 flex flex-col gap-4 min-h-0">
            <ScrollArea className="flex-grow" viewportRef={chatScrollAreaRef}>
                <div className="space-y-4">
                  {isLoading ? (
                      <div className="flex items-center justify-center h-full"><Loader className="h-8 w-8 animate-spin" /></div>
                  ) : messages.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-full text-center p-4">
                          <Bot className="h-12 w-12 text-muted-foreground" />
                          <p className="text-sm text-muted-foreground mt-2">AI 튜터에게 비디오 내용에 대해 궁금한 점을 질문해보세요.</p>
                      </div>
                  ) : (
                      messages.map(message => (
                        <div key={message.id} className={cn("flex items-end gap-2", message.role === 'user' ? 'justify-end' : 'justify-start')}>
                            {message.role === 'model' && <div className="flex-shrink-0 h-8 w-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center"><Bot className="h-5 w-5" /></div>}
                            <p className={cn("text-sm p-3 rounded-lg max-w-sm", message.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-white border')}>{message.content}</p>
                        </div>
                      ))
                  )}
                  {isPending && (
                      <div className="flex items-start gap-2 pt-4">
                          <div className="flex-shrink-0 h-8 w-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center"><Bot className="h-5 w-5 animate-spin" /></div>
                          <div className="p-3 rounded-lg bg-white border text-sm text-muted-foreground">답변을 생각하고 있어요...</div>
                      </div>
                  )}
                </div>
            </ScrollArea>
            <div className="flex-shrink-0">
                <div className="flex gap-2">
                    <Textarea 
                        placeholder={!isAIAvailable ? "AI 분석이 아직 완료되지 않았습니다." : "AI에게 질문할 내용을 입력하세요..."}
                        value={userQuestion}
                        onChange={(e) => setUserQuestion(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !isPending) { e.preventDefault(); handleAskQuestion(); } }}
                        disabled={isPending || !isAIAvailable}
                        className="flex-grow resize-none"
                    />
                    <Button onClick={handleAskQuestion} disabled={isPending || !userQuestion.trim() || !isAIAvailable}><Send className="h-4 w-4" /></Button>
                </div>
            </div>
        </div>
    );
};

const TextbookView = () => (
    <ScrollArea className="h-full">
        <div className="text-center flex flex-col items-center h-full justify-center">
            <Image src="https://picsum.photos/seed/textbook/200/280" width={150} height={210} alt="교재 이미지" className="rounded-md shadow-md" />
            <p className="text-sm text-muted-foreground mt-4">교재 정보는 현재 준비 중입니다.</p>
            <Button className="mt-4 bg-orange-500 hover:bg-orange-600 text-white font-bold">교재 구매하기</Button>
        </div>
    </ScrollArea>
);

const BookmarkView = ({ episode, user, videoRef }: { episode: Episode; user: User, videoRef: React.RefObject<HTMLVideoElement> }) => {
    const firestore = useFirestore();
    const { toast } = useToast();
    const [note, setNote] = useState('');
    const [isSaving, setIsSaving] = useState(false);

    const bookmarksQuery = useMemoFirebase(() => {
        if (!user || !firestore) return null;
        return query(
            collection(firestore, 'users', user.id, 'bookmarks'),
            where('episodeId', '==', episode.id),
            orderBy('timestamp', 'asc')
        );
    }, [user.id, episode.id, firestore]);

    const { data: bookmarks, isLoading } = useCollection<Bookmark>(bookmarksQuery);

    const formatTime = (seconds: number) => {
        const date = new Date(0);
        date.setSeconds(seconds);
        return date.toISOString().substr(14, 5); // MM:SS
    };

    const handleAddBookmark = async () => {
        if (!videoRef.current || !user || !firestore) return;
        
        const currentTime = Math.floor(videoRef.current.currentTime);

        if (bookmarks?.some(b => b.timestamp === currentTime)) {
            toast({
                variant: 'destructive',
                title: '오류',
                description: '이미 같은 시간에 북마크가 존재합니다.',
            });
            return;
        }

        setIsSaving(true);
        try {
            await addDoc(collection(firestore, 'users', user.id, 'bookmarks'), {
                userId: user.id,
                episodeId: episode.id,
                timestamp: currentTime,
                note: note.trim(),
                createdAt: FirebaseTimestamp.now(),
            });
            toast({ title: '성공', description: '북마크가 추가되었습니다.' });
            setNote('');
        } catch (error) {
            console.error(error);
            toast({ variant: 'destructive', title: '오류', description: '북마크 추가에 실패했습니다.' });
        } finally {
            setIsSaving(false);
        }
    };

    const handleDeleteBookmark = async (bookmarkId: string) => {
        if (!user || !firestore) return;
        try {
            await deleteDoc(doc(firestore, 'users', user.id, 'bookmarks', bookmarkId));
            toast({ title: '성공', description: '북마크가 삭제되었습니다.' });
        } catch (error) {
            console.error(error);
            toast({ variant: 'destructive', title: '오류', description: '북마크 삭제에 실패했습니다.' });
        }
    };
    
    const handleSeekTo = (time: number) => {
        if (videoRef.current) {
            videoRef.current.currentTime = time;
            videoRef.current.play();
        }
    };
    
    return (
        <ScrollArea className="h-full">
            <div className="space-y-4">
                <div className="space-y-2">
                    <Textarea 
                        placeholder="북마크에 메모를 추가하세요 (선택)"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        disabled={isSaving}
                    />
                    <Button 
                        className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
                        onClick={handleAddBookmark}
                        disabled={isSaving}
                    >
                      <BookmarkIcon className="mr-2 h-4 w-4" /> 
                      {isSaving ? '저장 중...' : '현재 시간 북마크'}
                    </Button>
                </div>
                
                {isLoading && <p className="text-center text-sm text-muted-foreground">북마크 로딩 중...</p>}
                
                {!isLoading && bookmarks && bookmarks.length === 0 && (
                    <p className="text-sm text-muted-foreground mt-6 text-center">저장된 북마크가 없습니다.</p>
                )}

                {!isLoading && bookmarks && bookmarks.length > 0 && (
                    <ul className="space-y-2">
                        {bookmarks.map(bookmark => (
                            <li key={bookmark.id} className="group flex justify-between items-center p-3 bg-white rounded-md text-sm border hover:bg-slate-50">
                                <button onClick={() => handleSeekTo(bookmark.timestamp)} className="text-left flex-grow min-w-0">
                                    <div className="flex items-center">
                                        <span className="font-mono text-primary font-semibold mr-3">[{formatTime(bookmark.timestamp)}]</span>
                                        <p className="truncate text-foreground">{bookmark.note || '메모 없음'}</p>
                                    </div>
                                    <span className="text-xs text-muted-foreground mt-1 block">{toDisplayDate(bookmark.createdAt)}</span>
                                </button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                                  onClick={() => handleDeleteBookmark(bookmark.id)}
                                >
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </ScrollArea>
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
  const firestore = useFirestore();
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [vttSrc, setVttSrc] = useState<string | null>(null);
  const [isLoadingSrc, setIsLoadingSrc] = useState(true);
  const [srcError, setSrcError] = useState<string | null>(null);

  const startTimeRef = useRef<Date | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const viewLoggedRef = useRef(false);

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

  const handleClose = useCallback(() => {
    videoRef.current?.pause();
    logView();
    onOpenChange(false);
  }, [logView, onOpenChange]);

  useEffect(() => {
    if (!isOpen) return;

    let unmounted = false;
    async function loadSources() {
        if (unmounted) return;
        setIsLoadingSrc(true);
        setSrcError(null);
        setVideoSrc(null);
        setVttSrc(null);

        try {
            const bucketName = firebaseConfig.storageBucket;
            if (!bucketName) {
                throw new Error("Firebase Storage bucket 설정이 누락되었습니다.");
            }
            if (episode.filePath) {
              const publicVideoUrl = getPublicUrl(bucketName, episode.filePath);
              if (unmounted) return;
              setVideoSrc(publicVideoUrl);
            } else {
              throw new Error("비디오 파일 경로를 찾을 수 없습니다.");
            }
            if (episode.vttPath) {
              const publicVttUrl = getPublicUrl(bucketName, episode.vttPath);
              if (unmounted) return;
              setVttSrc(publicVttUrl);
            }
        } catch(e: any) {
            if (unmounted) return;
            setSrcError(e.message || '소스 로딩 중 오류 발생');
        } finally {
            if (unmounted) return;
            setIsLoadingSrc(false);
        }
    }

    loadSources();
    startTimeRef.current = new Date();
    viewLoggedRef.current = false;

    return () => { unmounted = true; };
}, [isOpen, episode]);

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-none w-full h-full p-0 flex flex-col border-0 md:max-w-[95vw] md:h-[90vh] md:rounded-2xl"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => {
          if (videoRef.current?.contains(e.target as Node)) {
            e.preventDefault();
          }
        }}
      >
        <DialogHeader className="flex-shrink-0 flex items-center px-4 md:px-6 py-2 border-b bg-background rounded-t-lg md:rounded-t-2xl pr-12">
            <div className="flex items-center gap-2 text-sm md:text-base font-medium text-foreground truncate min-w-0">
                {courseLoading ? <Loader className="h-4 w-4 animate-spin"/> : <span className="font-bold truncate">{course?.name}</span>}
                <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <span className="text-muted-foreground truncate">{episode.title}</span>
            </div>
        </DialogHeader>

        <div className="flex-1 flex flex-col md:grid md:grid-cols-10 gap-0 md:gap-6 md:p-6 overflow-hidden bg-background md:bg-muted/50">
            {/* Video Player Section */}
            <Card className="col-span-10 md:col-span-7 flex flex-col bg-black md:rounded-xl overflow-hidden shadow-lg border-border">
                <div className="w-full flex-grow relative">
                    <div className="absolute inset-0 flex items-center justify-center">
                        {isLoadingSrc && <Loader className="h-12 w-12 text-white animate-spin" />}
                        {srcError && <div className="text-white bg-black/50 p-4 rounded-lg">{srcError}</div>}
                    </div>
                    {videoSrc && !isLoadingSrc && !srcError && (
                        <video
                            ref={videoRef}
                            key={episode.id}
                            controls
                            playsInline
                            webkit-playsinline="true"
                            autoPlay
                            className="w-full h-full object-contain"
                            crossOrigin="anonymous"
                        >
                            <source src={videoSrc} type="video/mp4" />
                            {vttSrc && <track src={vttSrc} kind="subtitles" srcLang="ko" label="한국어" default />}
                        </video>
                    )}
                </div>
            </Card>

            {/* Sidebar Section */}
            <Card className="col-span-10 md:col-span-3 flex flex-col md:bg-card md:rounded-xl shadow-lg border-border overflow-hidden min-h-0">
                <Tabs defaultValue="syllabus" className="flex-1 flex flex-col min-h-0">
                    <TabsList className="grid w-full grid-cols-4 flex-shrink-0 rounded-none h-auto p-0 bg-gray-50 border-b">
                        <TabsTrigger value="syllabus" className="py-3 rounded-none text-muted-foreground data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-none data-[state=active]:font-semibold relative after:content-[''] after:absolute after:bottom-[-1px] after:left-0 after:right-0 after:h-0.5 after:bg-primary after:scale-x-0 after:transition-transform data-[state=active]:after:scale-x-100">강의목차</TabsTrigger>
                        <TabsTrigger value="qna" className="py-3 rounded-none text-muted-foreground data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-none data-[state=active]:font-semibold relative after:content-[''] after:absolute after:bottom-[-1px] after:left-0 after:right-0 after:h-0.5 after:bg-primary after:scale-x-0 after:transition-transform data-[state=active]:after:scale-x-100">질문답변</TabsTrigger>
                        <TabsTrigger value="textbook" className="py-3 rounded-none text-muted-foreground data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-none data-[state=active]:font-semibold relative after:content-[''] after:absolute after:bottom-[-1px] after:left-0 after:right-0 after:h-0.5 after:bg-primary after:scale-x-0 after:transition-transform data-[state=active]:after:scale-x-100">교재정보</TabsTrigger>
                        <TabsTrigger value="bookmark" className="py-3 rounded-none text-muted-foreground data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-none data-[state=active]:font-semibold relative after:content-[''] after:absolute after:bottom-[-1px] after:left-0 after:right-0 after:h-0.5 after:bg-primary after:scale-x-0 after:transition-transform data-[state=active]:after:scale-x-100">북마크</TabsTrigger>
                    </TabsList>
                    <TabsContent value="syllabus" className="mt-0 flex flex-col flex-grow min-h-0 bg-white p-4">
                        <SyllabusView episode={episode} />
                    </TabsContent>
                    <TabsContent value="qna" className="mt-0 flex flex-col flex-grow min-h-0 bg-white p-4">
                        {user ? <ChatView episode={episode} user={user} /> : <div className="text-center p-4 text-sm text-muted-foreground">로그인 후 사용 가능합니다.</div>}
                    </TabsContent>
                    <TabsContent value="textbook" className="mt-0 flex-grow min-h-0 bg-white p-4">
                        <TextbookView />
                    </TabsContent>
                    <TabsContent value="bookmark" className="mt-0 flex-grow min-h-0 bg-white p-4">
                        {user ? <BookmarkView episode={episode} user={user} videoRef={videoRef}/> : <div className="text-center p-4 text-sm text-muted-foreground">로그인 후 사용 가능합니다.</div>}
                    </TabsContent>
                </Tabs>
            </Card>
        </div>
      </DialogContent>
    </Dialog>
  );
}
