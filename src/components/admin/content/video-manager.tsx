'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { MoreHorizontal, PlusCircle, ImageIcon } from 'lucide-react';
import type { Episode, Course, Classification, Field, Instructor } from '@/lib/types';
import VideoUploadDialog from '@/components/admin/content/video-upload-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useCollection, useFirestore, useMemoFirebase } from '@/firebase';
import { collection, doc, query, updateDoc, orderBy } from 'firebase/firestore';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { deleteHierarchyItem } from '@/lib/actions/delete-hierarchy-item';
import ThumbnailEditorDialog from '@/components/admin/content/thumbnail-editor-dialog';
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
import { sanitize } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';


export default function VideoManager() {
  const firestore = useFirestore();
  const { toast } = useToast();
  
  const episodesQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'episodes'), orderBy('createdAt', 'desc')) : null), [firestore]);
  const { data: episodes, isLoading: episodesLoading } = useCollection<Episode>(episodesQuery);
  
  const coursesQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'courses') : null), [firestore]);
  const { data: courses, isLoading: coursesLoading } = useCollection<Course>(coursesQuery);

  const classificationsQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'classifications') : null), [firestore]);
  const { data: classifications, isLoading: classLoading } = useCollection<Classification>(classificationsQuery);
  
  const fieldsQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'fields') : null), [firestore]);
  const { data: fields, isLoading: fieldsLoading } = useCollection<Field>(fieldsQuery);

  const instructorsQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'instructors') : null), [firestore]);
  const { data: instructors, isLoading: instructorsLoading } = useCollection<Instructor>(instructorsQuery);

  const [isUploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [isThumbnailDialogOpen, setThumbnailDialogOpen] = useState(false);
  const [selectedEpisode, setSelectedEpisode] = useState<Episode | null>(null);

  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [episodeToDelete, setEpisodeToDelete] = useState<Episode | null>(null);

  const handleOpenUploadDialog = (episode: Episode | null = null) => {
    setSelectedEpisode(episode);
    setUploadDialogOpen(true);
  };
  
  const handleOpenThumbnailDialog = (episode: Episode) => {
    setSelectedEpisode(episode);
    setThumbnailDialogOpen(true);
  };

  const getFullCoursePath = (courseId: string): string => {
    if (!courses || !classifications || !fields) return '? > ? > ?';
    
    const course = courses.find(c => c.id === courseId);
    if (!course) return `? > ? > ${courseId}`;

    const classification = classifications.find(c => c.id === course.classificationId);
    if (!classification) return `? > ? > ${course.name}`;

    const field = fields.find(f => f.id === classification.fieldId);
    if (!field) return `? > ${classification.name} > ${course.name}`;

    return `${field.name} > ${classification.name} > ${course.name}`;
  };

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


  const isLoading = episodesLoading || coursesLoading || classLoading || fieldsLoading || instructorsLoading;

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>비디오 관리</CardTitle>
            <p className="text-sm text-muted-foreground">개별 에피소드를 업로드하고 관리합니다.</p>
          </div>
          <Button onClick={() => handleOpenUploadDialog()}>
            <PlusCircle className="mr-2 h-4 w-4" />
            비디오 업로드
          </Button>
        </CardHeader>
        <CardContent>
          <TooltipProvider>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[80px]">썸네일</TableHead>
                  <TableHead>제목</TableHead>
                  <TableHead>소속 상세분류</TableHead>
                  <TableHead>재생 시간(초)</TableHead>
                  <TableHead>강사</TableHead>
                  <TableHead>무료 여부</TableHead>
                  <TableHead className="text-right">관리</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i}>
                          <TableCell colSpan={7}><Skeleton className="h-8 w-full" /></TableCell>
                      </TableRow>
                  ))
                ) : (
                  episodes?.map((episode) => (
                    <TableRow key={episode.id}>
                      <TableCell>
                          <div className="relative aspect-video w-20 rounded-md overflow-hidden bg-muted border">
                              {episode.thumbnailUrl ? (
                                  <Image
                                      src={episode.thumbnailUrl}
                                      alt={episode.title}
                                      fill
                                      sizes="80px"
                                      className="object-cover"
                                  />
                              ) : (
                                  <div className="flex items-center justify-center h-full w-full">
                                      <ImageIcon className="h-5 w-5 text-muted-foreground" />
                                  </div>
                              )}
                          </div>
                      </TableCell>
                      <TableCell className="font-medium">{episode.title}</TableCell>
                      <TableCell>{getFullCoursePath(episode.courseId)}</TableCell>
                      <TableCell>{episode.duration}</TableCell>
                      <TableCell>{getInstructorName(episode.instructorId)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={episode.isFree}
                            onCheckedChange={() => toggleFreeStatus(episode)}
                            aria-label="Toggle free status"
                          />
                          <Tooltip>
                            <TooltipTrigger>
                                <Badge variant={episode.isFree ? "secondary" : "outline"}>
                                    {episode.isFree ? '무료' : '유료'}
                                </Badge>
                            </TooltipTrigger>
                            <TooltipContent>
                                {episode.isFree ? <p>무료영상은 구독과 관계없이 누구나 시청가능합니다.</p> : <p>유료영상은 해당 분류의 이용권 구독자만 시청가능합니다.</p>}
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      </TableCell>
                      <TableCell className="text-right space-x-2">
                         <Button variant="outline" size="sm" asChild>
                           <Link href={episode.videoUrl} target="_blank" rel="noopener noreferrer" >
                              시청
                           </Link>
                         </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" className="h-8 w-8 p-0">
                              <span className="sr-only">메뉴 열기</span>
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleOpenUploadDialog(episode)}>
                              정보 수정
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleOpenThumbnailDialog(episode)}>
                              썸네일 수정
                            </DropdownMenuItem>
                            <DropdownMenuItem className="text-destructive" onClick={() => requestDeleteEpisode(episode)}>
                              삭제
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TooltipProvider>
        </CardContent>
      </Card>
      
      {isUploadDialogOpen && (
          <VideoUploadDialog 
            key={selectedEpisode?.id || 'new-upload'} 
            open={isUploadDialogOpen} 
            onOpenChange={setUploadDialogOpen} 
            episode={selectedEpisode}
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
