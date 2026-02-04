
'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
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
import { useCollection, useFirestore, useStorage, useMemoFirebase } from '@/firebase';
import { collection, doc, getDoc, query, where, setDoc } from 'firebase/firestore';
import type { Field, Classification, Course, Episode, Instructor } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { Separator } from '@/components/ui/separator';
import { PlusCircle, ImageIcon, X, Video } from 'lucide-react';
import HierarchyItemDialog, { type HierarchyItem } from './hierarchy-item-dialog';
import { saveEpisodeMetadata, updateEpisode } from '@/lib/actions/upload-episode';
import { uploadFile } from '@/firebase/storage/upload';
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
  onSuccess?: (courseId: string) => void;
}

type HierarchyDialogState = {
  isOpen: boolean;
  item: HierarchyItem | null;
  type: '분야' | '큰분류' | '상세분류';
};

export default function VideoUploadDialog({ open, onOpenChange, episode, onSuccess }: VideoUploadDialogProps) {
  const firestore = useFirestore();
  const storage = useStorage();
  const { toast } = useToast();
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadMessage, setUploadMessage] = useState<string>('');

  // Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isFree, setIsFree] = useState(false);
  const [duration, setDuration] = useState(0);
  const [selectedFieldId, setSelectedFieldId] = useState<string>('');
  const [selectedClassificationId, setSelectedClassificationId] = useState<string>('');
  const [selectedCourseId, setSelectedCourseId] = useState<string>('');
  const [selectedInstructorId, setSelectedInstructorId] = useState<string>('');

  // File state
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [defaultThumbnailFile, setDefaultThumbnailFile] = useState<File | null>(null);
  const [customThumbnailFile, setCustomThumbnailFile] = useState<File | null>(null);
  
  // Preview state
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null);
  const [defaultThumbnailPreview, setDefaultThumbnailPreview] = useState<string | null>(null);
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

  const resetForm = useCallback(() => {
    setIsProcessing(false);
    setUploadProgress(null);
    setUploadMessage('');
    setTitle('');
    setDescription('');
    setIsFree(false);
    setDuration(0);
    setSelectedFieldId('');
    setSelectedClassificationId('');
    setSelectedCourseId('');
    setSelectedInstructorId('');
    setVideoFile(null);
    setDefaultThumbnailFile(null);
    setCustomThumbnailFile(null);
    setVideoPreviewUrl(null);
    setDefaultThumbnailPreview(null);
    setCustomThumbnailPreview(null);
    setInitialEpisode(null);
  }, []);
  
  const handleSafeClose = () => {
    if (isProcessing) return;
    onOpenChange(false);
    setTimeout(resetForm, 150);
  };
  
 const generateDefaultThumbnail = useCallback((videoSrc: string, episodeId: string): Promise<File | null> => {
    return new Promise((resolve, reject) => {
        const videoElement = document.createElement('video');
        videoElement.src = videoSrc;
        videoElement.crossOrigin = "anonymous";
        videoElement.muted = true;
        videoElement.preload = "metadata";

        const cleanup = () => {
            videoElement.removeEventListener('seeked', onSeeked);
            videoElement.removeEventListener('error', onError);
            videoElement.removeEventListener('loadeddata', onLoadedData);
        };

        const onSeeked = () => {
            const canvas = document.createElement('canvas');
            canvas.width = videoElement.videoWidth;
            canvas.height = videoElement.videoHeight;
            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
                const dataUrl = canvas.toDataURL('image/jpeg');
                setDefaultThumbnailPreview(dataUrl);
                const generatedFile = dataURLtoFile(dataUrl, `default-thumb-${episodeId}.jpg`);
                setDefaultThumbnailFile(generatedFile);
                resolve(generatedFile);
            } else {
                reject(new Error('Canvas context is not available.'));
            }
            cleanup();
        };

        const onError = (e: Event | string) => {
            console.error("Error loading video for thumbnail generation.", { event: e, src: videoSrc });
            toast({variant: 'destructive', title:'썸네일 생성 실패', description: '비디오 파일에서 대표 썸네일을 생성하지 못했습니다.'});
            cleanup();
            reject(new Error('Failed to load video for thumbnail generation.'));
        };

        const onLoadedData = () => {
            videoElement.currentTime = 1; // Seek to 1 second
        };
        
        videoElement.addEventListener('loadeddata', onLoadedData);
        videoElement.addEventListener('seeked', onSeeked);
        videoElement.addEventListener('error', onError);

        videoElement.load(); // Start loading the video
    });
  }, [toast]);

  useEffect(() => {
    async function setInitialState() {
        if (isEditMode && episode && firestore) {
            setIsProcessing(true);
            setInitialEpisode(episode);
            setTitle(episode.title);
            setDescription(episode.description || '');
            setIsFree(episode.isFree);
            setDuration(episode.duration || 0);
            setSelectedCourseId(episode.courseId);
            setSelectedInstructorId(episode.instructorId || '');
            
            setVideoPreviewUrl(episode.videoUrl);
            setCustomThumbnailPreview(episode.customThumbnailUrl || null);

            // Re-generate default thumbnail from existing video URL
            if (episode.videoUrl) {
                try {
                    await generateDefaultThumbnail(episode.videoUrl, episode.id);
                } catch (error) {
                    console.error("Failed to re-generate default thumbnail on edit:", error);
                    // If regeneration fails, fall back to the stored URL for preview
                    setDefaultThumbnailPreview(episode.defaultThumbnailUrl || null);
                }
            }

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
  }, [open, episode, isEditMode, firestore, toast, resetForm, generateDefaultThumbnail]);

  const handleVideoFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setVideoFile(file);
      const videoURL = URL.createObjectURL(file);
      setVideoPreviewUrl(videoURL);
      setCustomThumbnailFile(null);
      setCustomThumbnailPreview(null);
      setDuration(0);

      const videoElement = document.createElement('video');
      videoElement.preload = 'metadata';
      videoElement.src = videoURL;
      
      videoElement.onloadedmetadata = async () => {
        setDuration(Math.round(videoElement.duration));
        try {
          await generateDefaultThumbnail(videoURL, episode?.id || uuidv4());
        } catch (error) {
          console.error("Error generating thumbnail for new video:", error);
        }
      };
      
      videoElement.onerror = () => {
        toast({variant: 'destructive', title: '오류', description: '비디오 파일 정보를 읽을 수 없습니다.'});
      };
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

  const handleSaveEpisode = async () => {
    if (!firestore || !storage) return;

    // Validation checks
    const missingFields = [];
    if (!title.trim()) missingFields.push('제목');
    if (!selectedCourseId) missingFields.push('상세분류');
    if (!selectedInstructorId) missingFields.push('강사');
    if (!isEditMode && !videoFile) missingFields.push('비디오 파일');
    if (!isEditMode && duration === 0) missingFields.push('비디오 재생 시간');

    if (missingFields.length > 0) {
        toast({
            variant: 'destructive',
            title: '입력 오류',
            description: `다음 필수 항목을 입력해주세요: ${missingFields.join(', ')}`,
        });
        return;
    }

    setIsProcessing(true);
    setUploadProgress(0);

    try {
        const episodeId = episode?.id || uuidv4();
        let newVideoUploadResult, newDefaultThumbUploadResult, newCustomThumbUploadResult;

        if (videoFile) {
            setUploadMessage('비디오 업로드 중...');
            const videoPath = `episodes/${episodeId}/video/${Date.now()}-${videoFile.name}`;
            newVideoUploadResult = await uploadFile(storage, videoPath, videoFile, setUploadProgress);
        }

        if (defaultThumbnailFile && (videoFile || isEditMode)) {
             setUploadMessage('대표 썸네일 업로드 중...');
            const thumbPath = `episodes/${episodeId}/default-thumbnail/${Date.now()}-${defaultThumbnailFile.name}`;
            newDefaultThumbUploadResult = await uploadFile(storage, thumbPath, defaultThumbnailFile, setUploadProgress);
        }
        
        if (customThumbnailFile) {
            setUploadMessage('커스텀 썸네일 업로드 중...');
            const thumbPath = `episodes/${episodeId}/custom-thumbnail/${Date.now()}-${customThumbnailFile.name}`;
            newCustomThumbUploadResult = await uploadFile(storage, thumbPath, customThumbnailFile, setUploadProgress);
        } else if (customThumbnailPreview === null && initialEpisode?.customThumbnailUrl) {
            // This indicates user wants to delete the custom thumbnail
            newCustomThumbUploadResult = { downloadUrl: null, filePath: null };
        }

        setUploadMessage('정보 저장 중...');
        
        if (isEditMode) {
            const payload = {
                episodeId, title, description, isFree, courseId: selectedCourseId, instructorId: selectedInstructorId,
                duration: duration,
                newVideoData: videoFile ? { ...newVideoUploadResult!, fileSize: videoFile.size } : undefined,
                newDefaultThumbnailData: newDefaultThumbUploadResult,
                newCustomThumbnailData: newCustomThumbUploadResult,
                oldVideoUrl: initialEpisode?.videoUrl,
                oldDefaultThumbnailUrl: initialEpisode?.defaultThumbnailUrl,
                oldCustomThumbnailUrl: initialEpisode?.customThumbnailUrl,
            };
            const result = await updateEpisode(sanitize(payload));
            if (!result.success) throw new Error(result.message);
            toast({ title: '수정 완료', description: `'${title}' 에피소드 정보가 업데이트되었습니다.` });
            onSuccess?.(selectedCourseId);

        } else { // Create mode
            if (!videoFile || !newVideoUploadResult || !newDefaultThumbUploadResult) {
                throw new Error("새 에피소드에는 비디오와 대표 썸네일이 필수입니다.");
            }
            const payload = {
                episodeId, title, description, isFree, selectedCourseId, instructorId: selectedInstructorId,
                duration: duration,
                videoUrl: newVideoUploadResult.downloadUrl,
                filePath: newVideoUploadResult.filePath,
                fileSize: videoFile.size,
                defaultThumbnailUrl: newDefaultThumbUploadResult.downloadUrl,
                defaultThumbnailPath: newDefaultThumbUploadResult.filePath,
                customThumbnailUrl: newCustomThumbUploadResult?.downloadUrl,
                customThumbnailPath: newCustomThumbUploadResult?.filePath,
            };
            const result = await saveEpisodeMetadata(sanitize(payload));
            if (!result.success) throw new Error(result.message);
            toast({ title: '업로드 성공', description: result.message });
            onSuccess?.(selectedCourseId);
        }
        handleSafeClose();
    } catch (error: any) {
      console.error("Episode save process failed:", error);
      toast({ variant: 'destructive', title: '저장 실패', description: error.message || '에피소드 저장 중 오류가 발생했습니다.' });
    } finally {
        setIsProcessing(false);
        setUploadProgress(null);
        setUploadMessage('');
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
  }

  const handleSaveHierarchy = async (item: HierarchyItem) => {
    if (!firestore) return;
    const { type } = hierarchyDialogState;
    const id = uuidv4();
    
    setIsProcessing(true);
    try {
        if (type === '분야') {
            await setDoc(doc(firestore, 'fields', id), { id, name: item.name, thumbnailUrl: '' });
            setSelectedFieldId(id);
            setSelectedClassificationId('');
            setSelectedCourseId('');
        } else if (type === '큰분류' && selectedFieldId) {
            await setDoc(doc(firestore, 'classifications', id), {
                id, fieldId: selectedFieldId, name: item.name,
                description: `${item.name}에 대한 설명입니다.`,
                thumbnailUrl: '',
            });
            setSelectedClassificationId(id);
            setSelectedCourseId('');
        } else if (type === '상세분류' && selectedClassificationId) {
            await setDoc(doc(firestore, 'courses', id), {
                id, classificationId: selectedClassificationId, name: item.name,
                description: `${item.name}에 대한 상세 설명입니다.`,
                thumbnailUrl: '',
                prices: { day1: 0, day30: 10000, day60: 18000, day90: 25000 },
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
  
  const ThumbnailPreview = ({ src, label, onRemove, fileName }: { src: string | null, label: string, onRemove?: () => void, fileName?: string | null }) => (
    <div className="flex-1 space-y-2">
      <div className="flex justify-between items-center">
        <Label className="text-muted-foreground">{label}</Label>
        {onRemove && src && (
            <Button
                variant="ghost"
                size="sm"
                className="h-6 px-1.5"
                onClick={onRemove}
                disabled={isProcessing}
                aria-label="커스텀 썸네일 삭제"
            >
                <X className="h-4 w-4" />
            </Button>
        )}
      </div>
      <div className="relative w-full aspect-video rounded-md overflow-hidden bg-muted border">
        {src ? (
          <Image src={src} alt={`${label} preview`} fill sizes="(max-width: 768px) 100vw, 50vw" className="object-cover" />
        ) : (
          <div className="flex flex-col items-center justify-center h-full w-full text-center p-2">
            <ImageIcon className="h-8 w-8 text-muted-foreground" />
            <span className="text-xs text-muted-foreground mt-2">
                {label === '대표 썸네일' ? '비디오를 선택하면 자동 생성됩니다.' : '사용자 지정 썸네일이 없습니다.'}
            </span>
          </div>
        )}
      </div>
      {fileName && <p className="text-xs text-muted-foreground truncate" title={fileName}>{fileName}</p>}
    </div>
  );

  return (
    <>
      <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) handleSafeClose(); }}>
        <DialogContent className="sm:max-w-4xl">
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
                  비디오 파일
                </Label>
                <div className="col-span-3 space-y-2">
                  <Input 
                      id="video-file" 
                      type="file" 
                      onChange={handleVideoFileChange}
                      accept="video/*"
                      disabled={isProcessing}
                  />
                  {isEditMode && initialEpisode?.videoUrl && (
                    <div className="text-xs text-muted-foreground flex items-center gap-2">
                        <Video className="h-4 w-4"/>
                        <span>현재 파일: </span>
                        <Link href={initialEpisode.videoUrl} target="_blank" className="truncate hover:underline" rel="noopener noreferrer">
                           {initialEpisode.filePath || '저장된 비디오 보기'}
                        </Link>
                    </div>
                  )}
                  {videoFile && <p className="text-sm text-green-600">새 비디오 파일 선택됨: {videoFile.name}</p>}
                </div>
            </div>
            <Separator />
             <div className="grid grid-cols-4 items-start gap-4">
                <Label className="text-right pt-2">썸네일</Label>
                <div className="col-span-3 space-y-4">
                    <div className="flex gap-4">
                        <ThumbnailPreview src={defaultThumbnailPreview} label="대표 썸네일" />
                        <ThumbnailPreview src={customThumbnailPreview} label="커스텀 썸네일" onRemove={handleRemoveCustomThumbnail} fileName={customThumbnailFile?.name}/>
                    </div>
                     <div>
                        <Label htmlFor="thumbnail-file" className="text-sm font-medium">커스텀 썸네일 업로드</Label>
                        <Input id="thumbnail-file" type="file" accept="image/*" onChange={handleCustomThumbnailFileChange} disabled={isProcessing} className="mt-1" />
                        {customThumbnailFile && <p className="text-xs text-green-600 mt-1">새 커스텀 썸네일 선택됨: {customThumbnailFile.name}</p>}
                    </div>
                </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleSafeClose} disabled={isProcessing}>취소</Button>
            <Button type="button" onClick={handleSaveEpisode} disabled={isProcessing}>
                {isProcessing ? `${uploadMessage} ${uploadProgress !== null ? `${Math.round(uploadProgress)}%` : ''}`.trim() : '에피소드 저장'}
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
