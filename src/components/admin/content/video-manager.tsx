'use client';

import { useState, useTransition, useMemo, useEffect, useCallback } from 'react';
import Image from 'next/image';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { MoreHorizontal, PlusCircle, ImageIcon, CheckCircle2, AlertTriangle, Loader, HelpCircle, GripVertical, KeyRound } from 'lucide-react';
import type { Episode, Course, Classification, Field, Instructor } from '@/lib/types';
import VideoUploadDialog from '@/components/admin/content/video-upload-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useCollection, useFirestore, useMemoFirebase } from '@/firebase';
import { collection, doc, query, updateDoc } from 'firebase/firestore';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { deleteHierarchyItem } from '@/lib/actions/delete-hierarchy-item';
import ThumbnailEditorDialog from './thumbnail-editor-dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { formatDuration, sanitize } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import VideoPlayerDialog from '@/components/shared/video-player-dialog';
import { resetAIEpisodeStatus } from '@/lib/actions/process-video';
import { Reorder } from 'framer-motion';
import { reorderEpisodes } from '@/lib/actions/reorder-episodes';


const AIStatusIndicator = ({ episode }: { 
    episode: Episode
}) => {
    const { toast } = useToast();
    const [isPending, startTransition] = useTransition();

    const handleStartAnalysis = () => {
        startTransition(async () => {
            const actionText = episode.aiProcessingStatus === 'completed' ? '재분석' : '분석';
            toast({ title: `AI ${actionText} 요청`, description: `'${episode.title}'에 대한 ${actionText}을 시작합니다.` });
            const result = await resetAIEpisodeStatus(episode.id);
            if (result.success) {
                toast({ title: "성공", description: result.message });
            } else {
                toast({ variant: 'destructive', title: "실패", description: result.message });
            }
        });
    };

    const modelName = episode.aiModel || '?';
    
    const statusContent = () => {
        if (isPending || episode.aiProcessingStatus === 'processing') {
            return (
                <Tooltip>
                    <TooltipTrigger>
                        <Loader className="h-4 w-4 text-blue-500 animate-spin" />
                    </TooltipTrigger>
                    <TooltipContent><p>AI 분석 처리 중...</p></TooltipContent>
                </Tooltip>
            );
        }
        
        switch (episode.aiProcessingStatus) {
            case 'completed':
                return (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-auto w-auto p-0" onClick={handleStartAnalysis}>
                                <CheckCircle2 className="h-4 w-4 text-green-500" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                            <p>AI 분석 완료</p>
                            <p className="font-semibold">클릭하여 재분석</p>
                        </TooltipContent>
                    </Tooltip>
                );
            case 'failed':
                return (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-auto w-auto p-0" onClick={handleStartAnalysis}>
                                <AlertTriangle className="h-4 w-4 text-destructive" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                            <p>AI 분석 실패: {episode.aiProcessingError || '알 수 없는 오류'}</p>
                            <p className="font-semibold">클릭하여 재시도</p>
                        </TooltipContent>
                    </Tooltip>
                );
            case 'pending':
            default:
                return (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-auto w-auto p-0" onClick={handleStartAnalysis}>
                                <HelpCircle className="h-4 w-4 text-muted-foreground" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent><p>AI 분석 대기 중. 클릭하여 시작</p></TooltipContent>
                    </Tooltip>
                );
        }
    };

    return (
        <div className="flex items-center gap-1">
            {statusContent()}
            <span className="text-xs text-muted-foreground">({modelName})</span>
        </div>
    );
};

const KeyStatusIndicator = ({ episode }: { episode: Episode }) => {
    if (episode.packagingStatus === 'failed') {
        return (
             <Tooltip>
                <TooltipTrigger>
                    <KeyRound className="h-4 w-4 text-destructive" />
                </TooltipTrigger>
                <TooltipContent><p>키 생성 실패. 재분석을 시도하세요.</p></TooltipContent>
            </Tooltip>
        )
    }
    
    if (episode.keyPath) {
        return (
            <Tooltip>
                <TooltipTrigger>
                    <KeyRound className="h-4 w-4 text-green-500" />
                </TooltipTrigger>
                <TooltipContent><p>암호화 키 저장됨</p></TooltipContent>
            </Tooltip>
        );
    }

    if (episode.packagingStatus === 'processing' || episode.packagingStatus === 'pending' || episode.aiProcessingStatus === 'processing' || episode.aiProcessingStatus === 'pending') {
        return (
            <Tooltip>
                <TooltipTrigger>
                    <KeyRound className="h-4 w-4 text-muted-foreground animate-pulse" />
                </TooltipTrigger>
                <TooltipContent><p>영상 처리 중...</p></TooltipContent>
            </Tooltip>
        );
    }

    return (
        <Tooltip>
            <TooltipTrigger>
                <KeyRound className="h-4 w-4 text-muted-foreground" />
            </TooltipTrigger>
            <TooltipContent><p>암호화 키 정보 없음.</p></TooltipContent>
        </Tooltip>
    );
};


const formatFileSize = (bytes: number | undefined): string => {
    if (bytes === undefined || bytes === 0) return 'N/A';
    if (bytes < 1024) return `${bytes} B`;
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
}


export default function VideoManager() {
  const firestore = useFirestore();
  const { toast } = useToast();
  
  // Data fetching
  const episodesQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'episodes') : null), [firestore]);
  const { data: episodes, isLoading: episodesLoading } = useCollection<Episode>(episodesQuery);
  
  const coursesQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'courses') : null), [firestore]);
  const { data: courses, isLoading: coursesLoading } = useCollection<Course>(coursesQuery);

  const classificationsQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'classifications') : null), [firestore]);
  const { data: classifications, isLoading: classLoading } = useCollection<Classification>(classificationsQuery);
  
  const fieldsQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'fields') : null), [firestore]);
  const { data: fields, isLoading: fieldsLoading } = useCollection<Field>(fieldsQuery);

  const instructorsQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'instructors') : null), [firestore]);
  const { data: instructors, isLoading: instructorsLoading } = useCollection<Instructor>(instructorsQuery);

  // Dialog states
  const [isUploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [isThumbnailDialogOpen, setThumbnailDialogOpen] = useState(false);
  const [isPlayerDialogOpen, setPlayerDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [openAccordionItems, setOpenAccordionItems] = useState<string[]>([]);
  
  // Selected items for dialogs
  const [selectedEpisode, setSelectedEpisode] = useState<Episode | null>(null);
  const [selectedInstructor, setSelectedInstructor] = useState<Instructor | null>(null);
  const [episodeToDelete, setEpisodeToDelete] = useState<Episode | null>(null);

  // Reordering state
  const [orderedEpisodes, setOrderedEpisodes] = useState<Record<string, Episode[]>>({});
  const [changedCourses, setChangedCourses] = useState<Set<string>>(new Set());
  const [isSavingOrder, startOrderSaveTransition] = useTransition();

  const getFullCoursePath = useCallback((courseId: string): string => {
    if (!courses || !classifications || !fields) return '? > ? > ?';
    
    const course = courses.find(c => c.id === courseId);
    if (!course) return `? > ? > ${courseId}`;

    const classification = classifications.find(c => c.id === course.classificationId);
    if (!classification) return `? > ? > ${course.name}`;

    const field = fields.find(f => f.id === classification.fieldId);
    if (!field) return `? > ${classification.name} > ${course.name}`;

    return `${field.name} > ${classification.name} > ${course.name}`;
  }, [courses, classifications, fields]);

  const groupedAndSortedEpisodes = useMemo(() => {
    if (!episodes || !courses) return {};
    
    const courseMap = new Map(courses.map(c => [c.id, c]));
    
    const groups: Record<string, { course: Course, episodes: Episode[] }> = {};

    for (const episode of episodes) {
        if (!groups[episode.courseId]) {
            const course = courseMap.get(episode.courseId);
            if (course) {
                groups[episode.courseId] = {
                    course: course,
                    episodes: [],
                };
            }
        }
        if (groups[episode.courseId]) {
            groups[episode.courseId].episodes.push(episode);
        }
    }
    
    // Sort episodes within each group by orderIndex
    for (const courseId in groups) {
        groups[courseId].episodes.sort((a, b) => (a.orderIndex ?? 999) - (b.orderIndex ?? 999));
    }
    
    return groups;
}, [episodes, courses]);

useEffect(() => {
    const initialOrder: Record<string, Episode[]> = {};
    for (const courseId in groupedAndSortedEpisodes) {
        initialOrder[courseId] = groupedAndSortedEpisodes[courseId].episodes;
    }
    setOrderedEpisodes(initialOrder);
    setChangedCourses(new Set()); // Reset changes when data reloads
}, [groupedAndSortedEpisodes]);


  const handleOpenUploadDialog = (episode: Episode | null = null) => {
    setSelectedEpisode(episode);
    setUploadDialogOpen(true);
  };
  
  const handleOpenThumbnailDialog = (episode: Episode) => {
    setSelectedEpisode(episode);
    setThumbnailDialogOpen(true);
  };
  
  const handlePlayVideo = (episode: Episode) => {
    setSelectedEpisode(episode);
    setSelectedInstructor(instructors?.find(i => i.id === episode.instructorId) || null);
    setPlayerDialogOpen(true);
  }

  const getInstructorName = (instructorId?: string): string => {
    if (!instructorId || !instructors) return 'N/A';
    return instructors.find(i => i.id === instructorId)?.name || '알 수 없음';
  };

  const toggleFreeStatus = async (episode: Episode) => {
    if (!firestore) return;
    const docRef = doc(firestore, 'episodes', episode.id);
    await updateDoc(docRef, { isFree: !episode.isFree });
    toast({
      title: '상태 변경',
      description: `${episode.title}의 무료 상태가 변경되었습니다.`,
    });
  };

  const requestDeleteEpisode = (episode: Episode) => {
    setEpisodeToDelete(episode);
    setIsDeleteDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!episodeToDelete) return;
    
    try {
        const result = await deleteHierarchyItem('episodes', episodeToDelete.id, sanitize(episodeToDelete));
        if (result.success) {
            toast({
                title: '삭제 완료',
                description: result.message,
            });
        } else {
            throw new Error(result.message);
        }
    } catch (error) {
        console.error("Failed to delete episode:", error);
        const errorMessage = error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
        toast({
            variant: 'destructive',
            title: '삭제 실패',
            description: errorMessage,
        });
    } finally {
        setIsDeleteDialogOpen(false);
        setEpisodeToDelete(null);
    }
  };

  const handleReorder = (courseId: string, newOrder: Episode[]) => {
    setOrderedEpisodes(prev => ({ ...prev, [courseId]: newOrder }));
    setChangedCourses(prev => new Set(prev).add(courseId));
  };

  const handleSaveOrder = (courseId: string) => {
      startOrderSaveTransition(async () => {
          const episodeIds = orderedEpisodes[courseId]?.map(ep => ep.id) || [];
          if(episodeIds.length === 0) return;

          const result = await reorderEpisodes(courseId, episodeIds);
          if (result.success) {
              toast({ title: '저장 완료', description: '에피소드 순서가 저장되었습니다.' });
              setChangedCourses(prev => {
                  const newSet = new Set(prev);
                  newSet.delete(courseId);
                  return newSet;
              })
          } else {
              toast({ variant: 'destructive', title: '저장 실패', description: result.message });
          }
      });
  };

  const handleUploadSuccess = (courseId: string) => {
    if (!openAccordionItems.includes(courseId)) {
      setOpenAccordionItems(prev => [...prev, courseId]);
    }
  };


  const isLoading = episodesLoading || coursesLoading || classLoading || fieldsLoading || instructorsLoading;

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>비디오 관리</CardTitle>
            <p className="text-sm text-muted-foreground">상세분류별로 에피소드를 드래그하여 순서를 변경하고 관리합니다.</p>
          </div>
          <Button onClick={() => handleOpenUploadDialog()}>
            <PlusCircle className="mr-2 h-4 w-4" />
            비디오 업로드
          </Button>
        </CardHeader>
        <CardContent>
          <TooltipProvider>
            {isLoading ? (
                <div className="space-y-4">
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-12 w-full" />
                </div>
            ) : Object.keys(orderedEpisodes).length > 0 ? (
                <>
                    <div className="hidden md:grid grid-cols-12 gap-3 items-center px-4 py-2 text-xs font-medium text-muted-foreground border-b sticky top-0 bg-background/95 z-10">
                        <div className="col-span-4 pl-8">에피소드 제목</div>
                        <div className="col-span-1">재생시간</div>
                        <div className="col-span-2">강사</div>
                        <div className="col-span-1 text-center">AI 상태</div>
                        <div className="col-span-1 text-center">키 상태</div>
                        <div className="col-span-1">무료</div>
                        <div className="col-span-2 text-right pr-12">관리</div>
                    </div>
                    <Accordion 
                        type="multiple" 
                        className="w-full space-y-2"
                        value={openAccordionItems}
                        onValueChange={setOpenAccordionItems}
                    >
                        {Object.entries(orderedEpisodes).map(([courseId, episodeList]) => {
                            const courseName = getFullCoursePath(courseId);
                            const isChanged = changedCourses.has(courseId);
                            return (
                                <AccordionItem value={courseId} key={courseId} className="border-b-0">
                                    <Card className="overflow-hidden">
                                    <div className="flex items-center w-full bg-muted/50 pr-4">
                                        <AccordionTrigger className="flex-grow px-4 py-2 text-left hover:no-underline">
                                            <div className="flex items-baseline gap-2 font-headline truncate">
                                                <span className="text-lg font-semibold truncate">{courseName}</span>
                                                <span className="text-sm text-muted-foreground flex-shrink-0">({episodeList.length}개 에피소드)</span>
                                            </div>
                                        </AccordionTrigger>
                                        <Button 
                                            disabled={!isChanged || isSavingOrder}
                                            onClick={(e) => { e.stopPropagation(); handleSaveOrder(courseId); }}
                                            className="ml-4 flex-shrink-0 h-7 text-xs px-2"
                                        >
                                            {isSavingOrder && changedCourses.has(courseId) ? '저장 중...' : '순서 저장'}
                                        </Button>
                                    </div>
                                    <AccordionContent className="p-2">
                                        <Reorder.Group axis="y" values={episodeList} onReorder={(newOrder) => handleReorder(courseId, newOrder as Episode[])}>
                                            <div className="space-y-2">
                                            {episodeList.map((episode) => (
                                                <Reorder.Item key={episode.id} value={episode} className="bg-background rounded-lg border">
                                                    <div className="p-2 grid grid-cols-12 gap-3 items-center">
                                                        <div className="col-span-4 flex items-center gap-3">
                                                            <GripVertical className="cursor-grab text-muted-foreground" />
                                                            <div className="relative aspect-video w-16 rounded-md overflow-hidden bg-muted border flex-shrink-0">
                                                                {episode.thumbnailUrl ? (
                                                                    <Image src={episode.thumbnailUrl} alt={episode.title} fill sizes="64px" className="object-cover" />
                                                                ) : (
                                                                    <ImageIcon className="h-5 w-5 text-muted-foreground m-auto" />
                                                                )}
                                                            </div>
                                                            <p className="font-medium truncate" title={episode.title}>{episode.title}</p>
                                                        </div>
                                                        <p className="truncate col-span-1">{formatDuration(episode.duration)}</p>
                                                        <p className="truncate col-span-2">{getInstructorName(episode.instructorId)}</p>
                                                        <div className="flex justify-center col-span-1">
                                                            <AIStatusIndicator episode={episode} />
                                                        </div>
                                                         <div className="flex justify-center col-span-1">
                                                            <KeyStatusIndicator episode={episode} />
                                                        </div>
                                                        <div className="flex items-center gap-2 col-span-1">
                                                            <Switch checked={episode.isFree} onCheckedChange={() => toggleFreeStatus(episode)} />
                                                            <span className="text-xs">{episode.isFree ? '무료' : '유료'}</span>
                                                        </div>
                                                        <div className="col-span-2 flex justify-end items-center">
                                                            <Button variant="outline" size="sm" onClick={() => handlePlayVideo(episode)}>시청</Button>
                                                            <DropdownMenu>
                                                              <DropdownMenuTrigger asChild>
                                                                <Button variant="ghost" className="h-8 w-8 p-0">
                                                                  <MoreHorizontal className="h-4 w-4" />
                                                                </Button>
                                                              </DropdownMenuTrigger>
                                                              <DropdownMenuContent align="end">
                                                                <DropdownMenuItem onClick={() => handleOpenUploadDialog(episode)}>정보 수정</DropdownMenuItem>
                                                                <DropdownMenuItem onClick={() => handleOpenThumbnailDialog(episode)}>썸네일 수정</DropdownMenuItem>
                                                                <DropdownMenuItem className="text-destructive" onClick={() => requestDeleteEpisode(episode)}>삭제</DropdownMenuItem>
                                                              </DropdownMenuContent>
                                                            </DropdownMenu>
                                                        </div>
                                                    </div>
                                                </Reorder.Item>
                                            ))}
                                            </div>
                                        </Reorder.Group>
                                    </AccordionContent>
                                    </Card>
                                </AccordionItem>
                            )
                        })}
                    </Accordion>
                </>
            ) : (
                <div className="text-center text-muted-foreground py-10">에피소드가 없습니다.</div>
            )}
          </TooltipProvider>
        </CardContent>
      </Card>
      
      {isUploadDialogOpen && (
          <VideoUploadDialog 
            key={selectedEpisode?.id || 'new-upload'} 
            open={isUploadDialogOpen} 
            onOpenChange={setUploadDialogOpen} 
            episode={selectedEpisode}
            onSuccess={handleUploadSuccess}
          />
      )}

      {isThumbnailDialogOpen && selectedEpisode && (
          <ThumbnailEditorDialog
              key={`${selectedEpisode.id}-thumb`}
              isOpen={isThumbnailDialogOpen}
              onClose={() => setThumbnailDialogOpen(false)}
              item={selectedEpisode}
              itemType="episodes"
          />
      )}

      {isPlayerDialogOpen && selectedEpisode && (
        <VideoPlayerDialog 
            isOpen={isPlayerDialogOpen}
            onOpenChange={setPlayerDialogOpen}
            episode={selectedEpisode}
            instructor={selectedInstructor}
        />
      )}

      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>정말 삭제하시겠습니까?</AlertDialogTitle>
            <AlertDialogDescription>
              &apos;{episodeToDelete?.title}&apos; 에피소드와 관련된 비디오 파일을 모두 삭제합니다. 이 작업은 되돌릴 수 없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setIsDeleteDialogOpen(false)}>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
