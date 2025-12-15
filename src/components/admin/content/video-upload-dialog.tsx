'use client';

import { useState, useEffect } from 'react';
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
import { useCollection, useFirestore, useMemoFirebase, useStorage } from '@/firebase';
import { collection, query, where, doc, setDoc } from 'firebase/firestore';
import type { Field, Classification, Course, Episode } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { v4 as uuidv4 } from 'uuid';

interface VideoUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function VideoUploadDialog({ open, onOpenChange }: VideoUploadDialogProps) {
  const firestore = useFirestore();
  const storage = useStorage();
  const { toast } = useToast();
  
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isFree, setIsFree] = useState(false);
  const [selectedField, setSelectedField] = useState<string | null>(null);
  const [selectedClassification, setSelectedClassification] = useState<string | null>(null);
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);

  const fieldsQuery = useMemoFirebase(() => collection(firestore, 'fields'), [firestore]);
  const { data: fields } = useCollection<Field>(fieldsQuery);

  const classificationsQuery = useMemoFirebase(() => 
    selectedField ? query(collection(firestore, 'classifications'), where('fieldId', '==', selectedField)) : null, 
    [firestore, selectedField]
  );
  const { data: classifications } = useCollection<Classification>(classificationsQuery);

  const coursesQuery = useMemoFirebase(() => 
    selectedClassification ? query(collection(firestore, 'courses'), where('classificationId', '==', selectedClassification)) : null, 
    [firestore, selectedClassification]
  );
  const { data: courses } = useCollection<Course>(coursesQuery);

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setIsFree(false);
    setSelectedField(null);
    setSelectedClassification(null);
    setSelectedCourseId(null);
    setVideoFile(null);
    setUploadProgress(0);
    setIsUploading(false);
  };

  const getVideoDuration = (file: File): Promise<number> => {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.onloadedmetadata = () => {
        window.URL.revokeObjectURL(video.src);
        resolve(Math.round(video.duration));
      };
      video.onerror = () => {
        reject('비디오 메타데이터를 읽는 데 실패했습니다.');
      };
      video.src = URL.createObjectURL(file);
    });
  };

  const handleSaveEpisode = async () => {
    if (!title || !selectedCourseId || !videoFile) {
      toast({
        variant: 'destructive',
        title: '입력 오류',
        description: '제목, 소속 상세분류, 비디오 파일을 모두 입력해야 합니다.',
      });
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);

    try {
      // 1. Get video duration
      const duration = await getVideoDuration(videoFile);

      // 2. Upload to Storage
      const episodeId = uuidv4();
      const storageRef = ref(storage, `episodes/${selectedCourseId}/${episodeId}/${videoFile.name}`);
      const uploadTask = uploadBytesResumable(storageRef, videoFile);

      // Wait for upload to complete
      const downloadUrl = await new Promise<string>((resolve, reject) => {
        uploadTask.on('state_changed',
          (snapshot) => {
            const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
            setUploadProgress(progress);
          },
          (error) => {
            console.error("Storage Upload failed:", error);
            reject(new Error('파일 스토리지 업로드에 실패했습니다. CORS나 Storage 규칙을 확인해주세요.'));
          },
          async () => {
            const url = await getDownloadURL(uploadTask.snapshot.ref);
            resolve(url);
          }
        );
      });
      
      // 3. Save to Firestore
      const newEpisodeDocRef = doc(firestore, 'courses', selectedCourseId, 'episodes', episodeId);
      
      const newEpisode: Omit<Episode, 'id'> = {
          courseId: selectedCourseId,
          title,
          description,
          duration,
          isFree,
          videoUrl: downloadUrl,
      };

      await setDoc(newEpisodeDocRef, newEpisode);

      toast({
        title: '업로드 완료',
        description: `${title} 에피소드가 성공적으로 추가되었습니다.`
      });
      onOpenChange(false); // Close dialog on success

    } catch (error: any) {
      console.error("Episode save process failed:", error);
      toast({
        variant: 'destructive',
        title: '저장 실패',
        description: error.message || '에피소드 저장 중 오류가 발생했습니다.',
      });
    } finally {
      setIsUploading(false);
    }
  };

  useEffect(() => {
    if (!open) {
      resetForm();
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[625px]">
        <DialogHeader>
          <DialogTitle className="font-headline">비디오 업로드</DialogTitle>
          <DialogDescription>
            새 에피소드를 추가하거나 기존 에피소드를 수정합니다.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="title" className="text-right">제목</Label>
            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} className="col-span-3" disabled={isUploading} />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="description" className="text-right">설명</Label>
            <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} className="col-span-3" disabled={isUploading} />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">분류</Label>
            <div className="col-span-3 grid grid-cols-3 gap-2 items-center">
              <Select value={selectedField || ''} onValueChange={(v) => { setSelectedField(v); setSelectedClassification(null); setSelectedCourseId(null); }} disabled={isUploading}>
                <SelectTrigger><SelectValue placeholder="분야" /></SelectTrigger>
                <SelectContent>{fields?.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={selectedClassification || ''} onValueChange={(v) => { setSelectedClassification(v); setSelectedCourseId(null); }} disabled={!selectedField || isUploading}>
                <SelectTrigger><SelectValue placeholder="큰분류" /></SelectTrigger>
                <SelectContent>{classifications?.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={selectedCourseId || ''} onValueChange={setSelectedCourseId} disabled={!selectedClassification || isUploading}>
                <SelectTrigger><SelectValue placeholder="상세분류" /></SelectTrigger>
                <SelectContent>{courses?.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <div />
            <div className="col-span-3 flex items-center space-x-2">
                <Checkbox id="isFree" checked={isFree} onCheckedChange={(checked) => setIsFree(!!checked)} disabled={isUploading} />
                <Label htmlFor="isFree">무료 콘텐츠</Label>
            </div>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="video-file" className="text-right">비디오 파일</Label>
            <Input 
                id="video-file" 
                type="file" 
                className="col-span-3" 
                onChange={(e) => setVideoFile(e.target.files ? e.target.files[0] : null)}
                accept="video/*"
                disabled={isUploading}
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="thumbnail-file" className="text-right">썸네일</Label>
            <div className="col-span-3 flex items-center gap-2">
                <Input id="thumbnail-file" type="file" disabled={isUploading} accept="image/*" />
                <Button variant="secondary" size="sm" disabled={isUploading}>AI 생성</Button>
            </div>
          </div>
          {isUploading && (
            <div className="col-span-4 mt-2">
              <Progress value={uploadProgress} />
              <p className="text-sm text-center text-muted-foreground mt-2">
                {uploadProgress < 100 ? `업로드 중... ${uploadProgress.toFixed(0)}%` : '업로드 완료, 처리 중...'}
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isUploading}>취소</Button>
          <Button type="button" onClick={handleSaveEpisode} disabled={isUploading || !videoFile || !selectedCourseId}>
            {isUploading ? '저장 중...' : '에피소드 저장'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
