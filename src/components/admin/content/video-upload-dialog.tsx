
'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { useCollection, useFirestore, useMemoFirebase } from '@/firebase';
import { collection, doc, addDoc, updateDoc, getDoc, query, where, setDoc } from 'firebase/firestore';
import type { Field, Classification, Course, Episode, Instructor } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { Separator } from '@/components/ui/separator';
import { PlusCircle, ImageIcon, XCircle, Video } from 'lucide-react';
import HierarchyItemDialog, { type HierarchyItem } from './hierarchy-item-dialog';
import { getSignedUploadUrl, saveEpisodeMetadata, updateEpisode } from '@/lib/actions/upload-episode';
import { v4 as uuidv4 } from 'uuid';
import Image from 'next/image';
import { sanitize } from '@/lib/utils';
import Link from 'next/link';

const dataURLtoFile = (dataurl: string, filename: string): File | null => {
    if (!dataurl) return null;
    const arr = dataurl.split(',');
    if (arr.length < 2) return null;

    const mimeMatch = arr[0].match(/:(.*?);/);
    if (!mimeMatch) return null;

    const mime = mimeMatch[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
    }
    return new File([u8arr], filename, { type: mime });
}


interface VideoUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  episode: Episode | null;
}

type HierarchyDialogState = {
  isOpen: boolean;
  item: HierarchyItem | null;
  type: '분야' | '큰분류' | '상세분류';
};

export default function VideoUploadDialog({ open, onOpenChange, episode }: VideoUploadDialogProps) {
  const firestore = useFirestore();
  const { toast } = useToast();
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isFree, setIsFree] = useState(false);
  const [selectedFieldId, setSelectedFieldId] = useState<string>('');
  const [selectedClassificationId, setSelectedClassificationId] = useState<string>('');
  const [selectedCourseId, setSelectedCourseId] = useState<string>('');
  const [selectedInstructorId, setSelectedInstructorId] = useState<string>('');

  const [videoFile, setVideoFile] = useState<File | null>(null);
  
  const [defaultThumbnailPreview, setDefaultThumbnailPreview] = useState<string | null>(null);
  const [customThumbnailFile, setCustomThumbnailFile] = useState<File | null>(null);
  const [customThumbnailPreview, setCustomThumbnailPreview] = useState<string | null>(null);
  
  const [initialEpisode, setInitialEpisode] = useState<Episode | null>(null);

  const [hierarchyDialogState, setHierarchyDialogState] = useState<HierarchyDialogState>({ isOpen: false, item: null, type: '분야' });

  const isEditMode = !!episode;

  const fieldsQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'fields') : null), [firestore]);
  const { data: dbFields } = useCollection<Field>(fieldsQuery);

  const classificationsQuery = useMemoFirebase(() => (
      firestore && selectedFieldId ? query(collection(firestore, 'classifications'), where('fieldId', '==', selectedFieldId)) : null
  ), [firestore, selectedFieldId]);
  const { data: filteredClassifications } = useCollection<Classification>(classificationsQuery);

  const coursesQuery = useMemoFirebase(() => (
      firestore && selectedClassificationId ? query(collection(firestore, 'courses'), where('classificationId', '==', selectedClassificationId)) : null
  ), [firestore, selectedClassificationId]);
  const { data: filteredCourses } = useCollection<Course>(coursesQuery);

  const instructorsQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'instructors') : null), [firestore]);
  const { data: instructors } = useCollection<Instructor>(instructorsQuery);

  const finalThumbnailPreview = customThumbnailPreview || defaultThumbnailPreview || initialEpisode?.thumbnailUrl;

  const resetForm = useCallback(() => {
    setTitle('');
    setDescription('');
    setIsFree(false);
    setSelectedFieldId('');
    setSelectedClassificationId('');
    setSelectedCourseId('');
    setSelectedInstructorId('');
    setVideoFile(null);
    setDefaultThumbnailPreview(null);
    setCustomThumbnailFile(null);
    setCustomThumbnailPreview(null);
    setInitialEpisode(null);
    setIsProcessing(false);
    setUploadProgress(null);
  }, []);
  
  const handleSafeClose = () => {
    if (isProcessing) return;
    onOpenChange(false);
    setTimeout(resetForm, 150);
  };

  useEffect(() => {
    async function setInitialState() {
        if (isEditMode && episode && firestore) {
            setIsProcessing(true);
            setInitialEpisode(episode);
            setTitle(episode.title);
            setDescription(episode.description || '');
            setIsFree(episode.isFree);
            setSelectedCourseId(episode.courseId);
            setSelectedInstructorId(episode.instructorId || '');
            
            try {
              const courseDocRef = doc(firestore, 'courses', episode.courseId);
              const courseDocSnap = await getDoc(courseDocRef);

              if (courseDocSnap.exists()) {
                  const course = courseDocSnap.data() as Course;
                  setSelectedClassificationId(course.classificationId);
                  const classDocRef = doc(firestore, 'classifications', course.classificationId);
                  const classDocSnap = await getDoc(classDocRef);
                  if (classDocSnap.exists()) {
                      const classification = classDocSnap.data() as Classification;
                      setSelectedFieldId(classification.fieldId);
                  }
              }
            } catch(e) {
              console.error("Error fetching hierarchy for episode:", e);
              toast({variant: 'destructive', title:'오류', description: '상위 분류 정보를 불러오는데 실패했습니다.'})
            } finally {
              setIsProcessing(false);
            }
        }
    }
    if (open) {
        setInitialState();
    } else {
        resetForm();
    }
  }, [open, episode, isEditMode, firestore, toast, resetForm]);

  const generateDefaultThumbnail = useCallback((file: File) => {
    const videoUrl = URL.createObjectURL(file);
    const videoElement = document.createElement('video');
    videoElement.src = videoUrl;
    videoElement.muted = true;
    
    videoElement.onloadeddata = () => {
        videoElement.currentTime = 1; // Seek to 1 second
    };

    videoElement.onseeked = () => {
        const canvas = document.createElement('canvas');
        canvas.width = videoElement.videoWidth;
        canvas.height = videoElement.videoHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL('image/jpeg');
            setDefaultThumbnailPreview(dataUrl);
        }
        URL.revokeObjectURL(videoUrl); // Clean up
    };

    videoElement.onerror = () => {
        console.error("Error loading video for thumbnail generation.");
        URL.revokeObjectURL(videoUrl);
    }
  }, []);

  const handleVideoFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
        setVideoFile(file);
        generateDefaultThumbnail(file);
    }
  };

  const handleCustomThumbnailFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setCustomThumbnailFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setCustomThumbnailPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleRemoveCustomThumbnail = () => {
      setCustomThumbnailFile(null);
      setCustomThumbnailPreview(null);
  }

  const uploadFileAndGetUrl = async (file: File, episodeId: string, itemType: 'videos' | 'thumbnails'): Promise<{uploadUrl: string, downloadUrl: string, filePath: string}> => {
      const signedUrlResult = await getSignedUploadUrl(file.name, file.type, episodeId, itemType);
      if (!signedUrlResult.success || !signedUrlResult.uploadUrl || !signedUrlResult.downloadUrl || !signedUrlResult.filePath) {
          throw new Error(signedUrlResult.message || '서명된 업로드 URL을 가져오지 못했습니다.');
      }

      setUploadProgress(0);
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', signedUrlResult.uploadUrl, true);
      xhr.setRequestHeader('Content-Type', file.type);
      
      xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
              const percentComplete = (event.loaded / event.total) * 100;
              setUploadProgress(percentComplete);
          }
      };

      await new Promise<void>((resolve, reject) => {
          xhr.onload = () => {
              if (xhr.status >= 200 && xhr.status < 300) {
                  resolve();
              } else {
                  reject(new Error(`파일 업로드 실패: ${xhr.statusText}`));
              }
          };
          xhr.onerror = () => reject(new Error('네트워크 오류로 파일 업로드에 실패했습니다.'));
          xhr.send(file);
      });
      
      return {
          uploadUrl: signedUrlResult.uploadUrl,
          downloadUrl: signedUrlResult.downloadUrl,
filePath: signedUrlResult.filePath,
      };
  }


  const handleSaveEpisode = async () => {
    if (!firestore) return;

    if (!title || !selectedCourseId) {
      toast({ variant: 'destructive', title: '입력 오류', description: '제목과 소속 상세분류는 필수입니다.' });
      return;
    }
    if (!isEditMode && !videoFile) {
        toast({ variant: 'destructive', title: '입력 오류', description: '새 에피소드에는 비디오 파일이 필수입니다.' });
        return;
    }

    setIsProcessing(true);

    try {
        const episodeId = isEditMode ? episode.id : uuidv4();
        let finalThumbnailUrl: string | null = null;
        let finalThumbnailPath: string | null = null;

        const defaultThumbFile = dataURLtoFile(defaultThumbnailPreview, `default-thumb-${episodeId}.jpg`);
        const thumbToUpload = customThumbnailFile || (!customThumbnailPreview && defaultThumbFile);
        
        if (thumbToUpload) {
             const thumbnailResult = await uploadFileAndGetUrl(thumbToUpload, episodeId, 'thumbnails');
             finalThumbnailUrl = thumbnailResult.downloadUrl;
             finalThumbnailPath = thumbnailResult.filePath;
        } else if (isEditMode) {
            // If no new thumb is uploaded, but we had a custom one that was removed, we need to clear it.
            // If there was no custom thumb to begin with, retain the old one.
            if (customThumbnailPreview === null && initialEpisode?.thumbnailUrl && customThumbnailFile === null) {
                finalThumbnailUrl = initialEpisode.thumbnailUrl;
                finalThumbnailPath = initialEpisode.thumbnailPath || null;
            } else if (customThumbnailPreview === null && customThumbnailFile === null) {
                // This means the custom thumb was explicitly removed
                finalThumbnailUrl = null;
                finalThumbnailPath = null;
            } else {
                finalThumbnailUrl = initialEpisode?.thumbnailUrl || null;
                finalThumbnailPath = initialEpisode?.thumbnailPath || null;
            }
        }
        
        if (isEditMode && episode) {
            let newVideoData: { videoUrl: string; filePath: string } | undefined = undefined;
            
            if (videoFile) {
                const urls = await uploadFileAndGetUrl(videoFile, episode.id, 'videos');
                newVideoData = { videoUrl: urls.downloadUrl, filePath: urls.filePath };
            }

            const result = await updateEpisode({
                episodeId: episode.id,
                title,
                description,
                isFree,
                courseId: selectedCourseId,
                instructorId: selectedInstructorId,
                thumbnailUrl: finalThumbnailUrl,
                thumbnailPath: finalThumbnailPath,
                newVideoData: newVideoData,
                oldFilePath: videoFile ? episode.filePath : undefined,
                oldThumbnailPath: thumbToUpload ? episode.thumbnailPath : (customThumbnailPreview === null && customThumbnailFile === null ? episode.thumbnailPath : undefined),
            });

            if (!result.success) throw new Error(result.message);
            toast({ title: '수정 완료', description: `'${title}' 에피소드 정보가 업데이트되었습니다.` });

        } else if (videoFile) { // Create mode
            const { downloadUrl: videoDownloadUrl, filePath: videoFilePath } = await uploadFileAndGetUrl(videoFile, episodeId, 'videos');
            
            const metadataResult = await saveEpisodeMetadata({
                episodeId,
                title,
                description,
                isFree,
                selectedCourseId,
                instructorId: selectedInstructorId,
                videoUrl: videoDownloadUrl,
                filePath: videoFilePath,
                thumbnailUrl: finalThumbnailUrl,
                thumbnailPath: finalThumbnailPath,
            });
            
            if (!metadataResult.success) throw new Error(metadataResult.message);
            toast({ title: '업로드 성공', description: metadataResult.message });
        }
      
      handleSafeClose();
      
    } catch (error: any) {
      console.error("Episode save process failed:", error);
      toast({
        variant: 'destructive',
        title: '저장 실패',
        description: error.message || '에피소드 저장 중 오류가 발생했습니다.',
      });
    } finally {
        setIsProcessing(false);
        setUploadProgress(null);
    }
  };

  const openHierarchyDialog = (type: HierarchyDialogState['type']) => {
    if ((type === '큰분류' && !selectedFieldId) || (type === '상세분류' && !selectedClassificationId)) {
      toast({ variant: 'destructive', title: '오류', description: '상위 계층을 먼저 선택해주세요.' });
      return;
    }
    setHierarchyDialogState({ isOpen: true, item: null, type });
  };
  
  const closeHierarchyDialog = () => {
    setHierarchyDialogState({ isOpen: false, item: null, type: '분야' });
    setTimeout(() => {
       // Focus management logic if needed
    }, 150);
  }

  const handleSaveHierarchy = async (item: HierarchyItem) => {
    if (!firestore) return;
    const { type } = hierarchyDialogState;

    setIsProcessing(true);
    try {
        const id = uuidv4();
        if (type === '분야') {
            await setDoc(doc(firestore, 'fields', id), { id, name: item.name, thumbnailUrl: '' });
            setSelectedFieldId(id);
            setSelectedClassificationId('');
            setSelectedCourseId('');
        } else if (type === '큰분류' && selectedFieldId) {
            await setDoc(doc(firestore, 'classifications', id), {
                id,
                fieldId: selectedFieldId,
                name: item.name,
                description: `${item.name}에 대한 설명입니다.`,
                prices: { day1: 0, day30: 10000, day60: 18000, day90: 25000 },
                thumbnailUrl: '',
            });
            setSelectedClassificationId(id);
            setSelectedCourseId('');
        } else if (type === '상세분류' && selectedClassificationId) {
            await setDoc(doc(firestore, 'courses', id), {
                id,
                classificationId: selectedClassificationId,
                name: item.name,
                description: `${item.name}에 대한 상세 설명입니다.`,
                thumbnailUrl: '',
            });
            setSelectedCourseId(id);
        }
         toast({ title: '저장 완료', description: `'${item.name}' 항목이 성공적으로 추가되었습니다.` });
    } catch (e) {
        toast({ variant: 'destructive', title: '저장 실패', description: `항목 추가 중 오류가 발생했습니다.` });
    } finally {
        setIsProcessing(false);
        closeHierarchyDialog();
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) handleSafeClose(); }}>
        <DialogContent className="sm:max-w-[625px]">
          <DialogHeader>
            <DialogTitle className="font-headline">{isEditMode ? '에피소드 수정' : '비디오 업로드'}</DialogTitle>
            <DialogDescription>
              {isEditMode ? '에피소드 정보를 수정합니다.' : '새 에피소드를 추가합니다.'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4 max-h-[70vh] overflow-y-auto pr-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="title" className="text-right">제목</Label>
              <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} className="col-span-3" disabled={isProcessing} />
            </div>
            <div className="grid grid-cols-4 items-start gap-4">
              <Label htmlFor="description" className="text-right pt-2">설명</Label>
              <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} className="col-span-3" disabled={isProcessing} />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">분류</Label>
              <div className="col-span-3 grid grid-cols-3 gap-2 items-center">
                <Select value={selectedFieldId} onValueChange={(v) => { setSelectedFieldId(v); setSelectedClassificationId(''); setSelectedCourseId(''); }} disabled={isProcessing}>
                  <SelectTrigger><SelectValue placeholder="분야" /></SelectTrigger>
                  <SelectContent>
                    {dbFields?.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                    <Separator className="my-1" />
                    <Button variant="ghost" className="w-full justify-start h-8 px-2" onClick={(e) => {e.preventDefault(); openHierarchyDialog('분야')}}>
                        <PlusCircle className="mr-2 h-4 w-4" /> 새로 추가...
                    </Button>
                  </SelectContent>
                </Select>
                <Select value={selectedClassificationId} onValueChange={(v) => { setSelectedClassificationId(v); setSelectedCourseId(''); }} disabled={!selectedFieldId || isProcessing}>
                  <SelectTrigger><SelectValue placeholder="큰분류" /></SelectTrigger>
                  <SelectContent>
                    {filteredClassifications?.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    <Separator className="my-1" />
                    <Button variant="ghost" className="w-full justify-start h-8 px-2" onClick={(e) => {e.preventDefault(); openHierarchyDialog('큰분류')}} disabled={!selectedFieldId}>
                        <PlusCircle className="mr-2 h-4 w-4" /> 새로 추가...
                    </Button>
                  </SelectContent>
                </Select>
                <Select value={selectedCourseId} onValueChange={setSelectedCourseId} disabled={!selectedClassificationId || isProcessing}>
                  <SelectTrigger><SelectValue placeholder="상세분류" /></SelectTrigger>
                  <SelectContent>
                    {filteredCourses?.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    <Separator className="my-1" />
                    <Button variant="ghost" className="w-full justify-start h-8 px-2" onClick={(e) => {e.preventDefault(); openHierarchyDialog('상세분류')}} disabled={!selectedClassificationId}>
                        <PlusCircle className="mr-2 h-4 w-4" /> 새로 추가...
                    </Button>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="instructor" className="text-right">강사</Label>
                <div className="col-span-3">
                    <Select value={selectedInstructorId} onValueChange={setSelectedInstructorId} disabled={isProcessing}>
                        <SelectTrigger><SelectValue placeholder="강사 선택" /></SelectTrigger>
                        <SelectContent>
                            {instructors?.map(i => <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </div>
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <div />
              <div className="col-span-3 flex items-center space-x-2">
                  <Checkbox id="isFree" checked={isFree} onCheckedChange={(checked) => setIsFree(!!checked)} disabled={isProcessing} />
                  <Label htmlFor="isFree">무료 콘텐츠</Label>
              </div>
            </div>
            <Separator />
             <div className="grid grid-cols-4 items-start gap-4">
                <Label htmlFor="video-file" className="text-right pt-2">
                  {isEditMode ? '비디오 교체' : '비디오 파일'}
                </Label>
                <div className="col-span-3 space-y-2">
                  <Input 
                      id="video-file" 
                      type="file" 
                      onChange={handleVideoFileChange}
                      accept="video/*"
                      disabled={isProcessing}
                  />
                  {videoFile && <p className="text-sm text-muted-foreground">새 파일 선택됨: {videoFile.name}</p>}
                  {isEditMode && initialEpisode?.videoUrl && (
                    <div className="text-xs text-muted-foreground flex items-center gap-2">
                        <Video className="h-4 w-4"/>
                        <span>현재 파일: </span>
                        <Link href={initialEpisode.videoUrl} target="_blank" className="truncate hover:underline" rel="noopener noreferrer">
                           {initialEpisode.filePath || '저장된 비디오 보기'}
                        </Link>
                    </div>
                  )}
                </div>
            </div>
            <Separator />
             <div className="grid grid-cols-4 items-start gap-4">
                <Label className="text-right pt-2">썸네일</Label>
                <div className="col-span-3 space-y-2">
                    <div className="relative w-full aspect-video rounded-md overflow-hidden bg-muted border">
                        {finalThumbnailPreview ? (
                            <Image src={finalThumbnailPreview} alt="썸네일 미리보기" fill sizes="300px" className="object-cover" />
                        ) : (
                            <div className="flex flex-col items-center justify-center h-full w-full text-center">
                                <ImageIcon className="h-10 w-10 text-muted-foreground" />
                                <span className="text-xs text-muted-foreground mt-2">비디오 파일을 선택하면<br/>자동으로 썸네일이 생성됩니다.</span>
                            </div>
                        )}
                        {customThumbnailPreview && (
                            <Button 
                                variant="destructive" 
                                size="icon" 
                                className="absolute top-1 right-1 h-6 w-6"
                                onClick={handleRemoveCustomThumbnail}
                                disabled={isProcessing}
                            >
                                <XCircle className="h-4 w-4" />
                            </Button>
                        )}
                    </div>
                    <Label htmlFor="thumbnail-file" className="text-sm font-medium text-muted-foreground">
                        {customThumbnailFile ? `선택된 파일: ${customThumbnailFile.name}`: '또는, 커스텀 썸네일 업로드'}
                    </Label>
                    <Input id="thumbnail-file" type="file" accept="image/*" onChange={handleCustomThumbnailFileChange} disabled={isProcessing} />
                </div>
            </div>
             {uploadProgress !== null && (
                <div className="grid grid-cols-4 items-center gap-4">
                    <div />
                    <div className="col-span-3 mt-2">
                        <Progress value={uploadProgress} />
                        <p className="text-sm text-center text-muted-foreground mt-2">
                            {uploadProgress < 100 ? `업로드 중... ${Math.round(uploadProgress)}%` : '업로드 완료! 메타데이터 저장 중...'}
                        </p>
                    </div>
                </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleSafeClose} disabled={isProcessing}>취소</Button>
            <Button type="button" onClick={handleSaveEpisode} disabled={isProcessing || (isEditMode ? false : !videoFile) || !selectedCourseId }>
              {isProcessing ? `처리 중... ${uploadProgress !== null ? Math.round(uploadProgress) + '%' : ''}`.trim() : '에피소드 저장'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {hierarchyDialogState.isOpen && (
        <HierarchyItemDialog
          isOpen={hierarchyDialogState.isOpen}
          onClose={closeHierarchyDialog}
          onSave={handleSaveHierarchy}
          item={hierarchyDialogState.item}
          itemType={hierarchyDialogState.type}
        />
      )}
    </>
  );
}
