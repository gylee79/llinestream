'use client';

import { useState, useEffect, useRef } from 'react';
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
import { collection, doc, addDoc, updateDoc, getDoc, query, where } from 'firebase/firestore';
import type { Field, Classification, Course, Episode } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { Separator } from '@/components/ui/separator';
import { PlusCircle, ImageIcon } from 'lucide-react';
import HierarchyItemDialog, { type HierarchyItem } from './hierarchy-item-dialog';
import { getSignedUploadUrl, saveEpisodeMetadata, updateEpisode } from '@/lib/actions/upload-episode';
import { updateThumbnail } from '@/lib/actions/update-thumbnail';
import { v4 as uuidv4 } from 'uuid';
import Image from 'next/image';

const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = error => reject(error);
    });
};

const dataURLtoFile = (dataurl: string, filename: string): File => {
    const arr = dataurl.split(',');
    if (arr.length < 2) {
        throw new Error('Invalid data URL');
    }
    const mimeMatch = arr[0].match(/:(.*?);/);
    if (!mimeMatch) {
        throw new Error('Could not find MIME type');
    }
    const mime = mimeMatch[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while(n--){
        u8arr[n] = bstr.charCodeAt(n);
    }
    return new File([u8arr], filename, {type:mime});
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
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);
  const [thumbnailPreview, setThumbnailPreview] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);


  const [hierarchyDialogState, setHierarchyDialogState] = useState<HierarchyDialogState>({ isOpen: false, item: null, type: '분야' });

  const isEditMode = !!episode;
  const isLoading = isProcessing;

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


  const resetForm = () => {
    setTitle('');
    setDescription('');
    setIsFree(false);
    setSelectedFieldId('');
    setSelectedClassificationId('');
    setSelectedCourseId('');
    setVideoFile(null);
    setThumbnailFile(null);
    setThumbnailPreview(null);
    setIsProcessing(false);
    setUploadProgress(null);
  };
  
  useEffect(() => {
    async function setInitialState() {
        if (isEditMode && episode && firestore) {
            setIsProcessing(true);
            setTitle(episode.title);
            setDescription(episode.description || '');
            setIsFree(episode.isFree);
            setSelectedCourseId(episode.courseId);
            setThumbnailPreview(episode.thumbnailUrl || null);

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
}, [open, episode, isEditMode, firestore, toast]);

  const handleThumbnailFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setThumbnailFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setThumbnailPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };
  
  const handleVideoFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
        setVideoFile(file);
        
        // Auto-generate thumbnail only if user hasn't selected one
        if (!thumbnailFile && !thumbnailPreview) {
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
                    setThumbnailPreview(dataUrl);
                    // Also set this as a file to be uploaded
                    const generatedThumbnailFile = dataURLtoFile(dataUrl, 'thumbnail.jpg');
                    setThumbnailFile(generatedThumbnailFile);
                }
                URL.revokeObjectURL(videoUrl); // Clean up
            };

            videoElement.onerror = () => {
                console.error("Error loading video for thumbnail generation.");
                URL.revokeObjectURL(videoUrl);
            }
        }
    }
  };


  const uploadFileAndGetUrl = async (file: File, episodeId: string): Promise<{uploadUrl: string, downloadUrl: string, filePath: string}> => {
      const signedUrlResult = await getSignedUploadUrl(file.name, file.type, episodeId);
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

      await new Promise((resolve, reject) => {
          xhr.onload = () => {
              if (xhr.status >= 200 && xhr.status < 300) {
                  resolve(xhr.response);
              } else {
                  reject(new Error(`파일 업로드 실패: ${xhr.statusText}`));
              }
          };
          xhr.onerror = () => reject(new Error('네트워크 오류로 파일 업로드에 실패했습니다.'));
          xhr.send(file);
      });
      setUploadProgress(100);
      
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
        let episodeId = isEditMode ? episode.id : uuidv4();

        // 1. Handle Thumbnail Upload (if any)
        if (thumbnailFile) {
            const base64Image = await fileToBase64(thumbnailFile);
            await updateThumbnail({
                itemType: 'episodes',
                itemId: episodeId,
                base64Image,
                imageContentType: thumbnailFile.type,
                imageName: thumbnailFile.name,
            });
        }
        
        // 2. Handle Video Upload & Metadata
        if (isEditMode && episode) { // Update existing episode
            let newVideoData: { videoUrl: string; filePath: string } | undefined = undefined;
            
            if (videoFile) { // If a new video is uploaded
                const urls = await uploadFileAndGetUrl(videoFile, episode.id);
                newVideoData = { videoUrl: urls.downloadUrl, filePath: urls.filePath };
            }

            const result = await updateEpisode({
                title,
                description,
                isFree,
                courseId: selectedCourseId,
                episodeId: episode.id,
                newVideoData: newVideoData,
                oldVideoUrl: newVideoData ? episode.videoUrl : undefined,
                oldFilePath: newVideoData ? episode.filePath : undefined
            });

            if (result.success) {
                toast({ title: '수정 완료', description: `'${title}' 에피소드 정보가 업데이트되었습니다.` });
            } else {
                throw new Error(result.message);
            }

        } else if (videoFile) { // Create new episode
            const { downloadUrl, filePath } = await uploadFileAndGetUrl(videoFile, episodeId);
            
            const metadataResult = await saveEpisodeMetadata({
                episodeId,
                title,
                description,
                isFree,
                selectedCourseId,
                videoUrl: downloadUrl,
                filePath: filePath
            });
            
            if (metadataResult.success) {
                toast({ title: '업로드 성공', description: metadataResult.message });
            } else {
                throw new Error(metadataResult.message);
            }
        }
      
      onOpenChange(false);

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
  const closeHierarchyDialog = () => setHierarchyDialogState({ isOpen: false, item: null, type: '분야' });

  const handleSaveHierarchy = async (item: HierarchyItem) => {
    if (!firestore) return;
    const { type } = hierarchyDialogState;

    setIsProcessing(true);
    try {
        let newDocId = '';
        if (type === '분야') {
            const docRef = await addDoc(collection(firestore, 'fields'), { 
                name: item.name, 
                thumbnailUrl: '', 
            });
            newDocId = docRef.id;
            setSelectedFieldId(newDocId);
            setSelectedClassificationId('');
            setSelectedCourseId('');
        } else if (type === '큰분류' && selectedFieldId) {
            const docRef = await addDoc(collection(firestore, 'classifications'), {
                fieldId: selectedFieldId,
                name: item.name,
                description: `${item.name}에 대한 설명입니다.`,
                prices: { day1: 0, day30: 10000, day60: 18000, day90: 25000 },
                thumbnailUrl: '',
            });
            newDocId = docRef.id;
            setSelectedClassificationId(newDocId);
            setSelectedCourseId('');
        } else if (type === '상세분류' && selectedClassificationId) {
            const docRef = await addDoc(collection(firestore, 'courses'), {
                classificationId: selectedClassificationId,
                name: item.name,
                description: `${item.name}에 대한 상세 설명입니다.`,
                thumbnailUrl: '',
            });
            newDocId = docRef.id;
            setSelectedCourseId(newDocId);
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
      <Dialog open={open} onOpenChange={onOpenChange}>
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
              <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} className="col-span-3" disabled={isLoading} />
            </div>
            <div className="grid grid-cols-4 items-start gap-4">
              <Label htmlFor="description" className="text-right pt-2">설명</Label>
              <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} className="col-span-3" disabled={isLoading} />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">분류</Label>
              <div className="col-span-3 grid grid-cols-3 gap-2 items-center">
                <Select value={selectedFieldId} onValueChange={(v) => { setSelectedFieldId(v); setSelectedClassificationId(''); setSelectedCourseId(''); }} disabled={isLoading}>
                  <SelectTrigger><SelectValue placeholder="분야" /></SelectTrigger>
                  <SelectContent>
                    {dbFields?.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                    <Separator className="my-1" />
                    <Button variant="ghost" className="w-full justify-start h-8 px-2" onClick={(e) => {e.preventDefault(); openHierarchyDialog('분야')}}>
                        <PlusCircle className="mr-2 h-4 w-4" /> 새로 추가...
                    </Button>
                  </SelectContent>
                </Select>
                <Select value={selectedClassificationId} onValueChange={(v) => { setSelectedClassificationId(v); setSelectedCourseId(''); }} disabled={!selectedFieldId || isLoading}>
                  <SelectTrigger><SelectValue placeholder="큰분류" /></SelectTrigger>
                  <SelectContent>
                    {filteredClassifications?.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    <Separator className="my-1" />
                    <Button variant="ghost" className="w-full justify-start h-8 px-2" onClick={(e) => {e.preventDefault(); openHierarchyDialog('큰분류')}} disabled={!selectedFieldId}>
                        <PlusCircle className="mr-2 h-4 w-4" /> 새로 추가...
                    </Button>
                  </SelectContent>
                </Select>
                <Select value={selectedCourseId} onValueChange={setSelectedCourseId} disabled={!selectedClassificationId || isLoading}>
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
              <div />
              <div className="col-span-3 flex items-center space-x-2">
                  <Checkbox id="isFree" checked={isFree} onCheckedChange={(checked) => setIsFree(!!checked)} disabled={isLoading} />
                  <Label htmlFor="isFree">무료 콘텐츠</Label>
              </div>
            </div>
            <Separator />
             <div className="grid grid-cols-4 items-start gap-4">
                <Label className="text-right pt-2">썸네일</Label>
                <div className="col-span-3 space-y-2">
                    <div className="relative w-full aspect-video rounded-md overflow-hidden bg-muted border">
                        {thumbnailPreview ? (
                            <Image src={thumbnailPreview} alt="썸네일 미리보기" fill className="object-cover" />
                        ) : (
                            <div className="flex items-center justify-center h-full w-full">
                                <ImageIcon className="h-10 w-10 text-muted-foreground" />
                            </div>
                        )}
                    </div>
                    <Input id="thumbnail-file" type="file" accept="image/*" onChange={handleThumbnailFileChange} disabled={isLoading} />
                </div>
            </div>
            <Separator />
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="video-file" className="text-right">
                {isEditMode ? '비디오 교체' : '비디오 파일'}
              </Label>
              <Input 
                  id="video-file" 
                  type="file" 
                  className="col-span-3" 
                  onChange={handleVideoFileChange}
                  accept="video/*"
                  disabled={isLoading}
              />
            </div>
            {isEditMode && !videoFile && (
                <div className="grid grid-cols-4 items-center gap-4">
                    <div />
                    <p className="col-span-3 text-sm text-muted-foreground">
                        새 비디오 파일을 선택하면 기존 영상이 교체됩니다. 선택하지 않으면 영상은 변경되지 않습니다.
                    </p>
                </div>
            )}
             {uploadProgress !== null && (
                <div className="col-span-full mt-2">
                    <Progress value={uploadProgress} />
                    <p className="text-sm text-center text-muted-foreground mt-2">
                        {uploadProgress < 100 ? `업로드 중... ${Math.round(uploadProgress)}%` : '업로드 완료! 메타데이터 저장 중...'}
                    </p>
                </div>
            )}
            {isLoading && isEditMode && (
              <div className="col-span-full mt-2">
                <p className="text-sm text-center text-muted-foreground mt-2">
                  분류 정보 로딩 중...
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>취소</Button>
            <Button type="button" onClick={handleSaveEpisode} disabled={isLoading || (isEditMode ? false : !videoFile) || !selectedCourseId }>
              {isLoading ? '처리 중...' : '에피소드 저장'}
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

    