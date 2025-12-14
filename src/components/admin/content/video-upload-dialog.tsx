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

  const handleUpload = async () => {
    if (!title || !selectedCourseId || !videoFile) {
      toast({
        variant: 'destructive',
        title: '입력 오류',
        description: '제목, 소속 상세분류, 비디오 파일을 모두 선택해야 합니다.',
      });
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);

    // 1. Create a new document reference in the subcollection to get a unique ID.
    const newEpisodeDocRef = doc(collection(firestore, 'courses', selectedCourseId, 'episodes'));
    const episodeId = newEpisodeDocRef.id;

    // 2. Create a storage reference using the new document ID.
    const storageRef = ref(storage, `episodes/${selectedCourseId}/${episodeId}/${videoFile.name}`);
    const uploadTask = uploadBytesResumable(storageRef, videoFile);

    // 3. Set up the upload task listeners.
    uploadTask.on('state_changed',
      (snapshot) => {
        const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
        setUploadProgress(progress);
      },
      (error) => {
        console.error("Upload failed:", error);
        toast({
          variant: 'destructive',
          title: '업로드 실패',
          description: '파일 업로드 중 오류가 발생했습니다.',
        });
        setIsUploading(false);
      },
      async () => {
        // 4. On successful upload, get the download URL.
        const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
        
        // 5. Prepare the new episode data object.
        const newEpisode: Omit<Episode, 'id'> = {
          courseId: selectedCourseId,
          title,
          description,
          duration: 0, // Should be extracted from video file metadata on server
          isFree,
          videoUrl: downloadURL,
        };

        try {
          // 6. Use `setDoc` with the reference created in step 1 to save the data.
          await setDoc(newEpisodeDocRef, newEpisode);

          toast({
            title: '업로드 완료',
            description: `${title} 에피소드가 성공적으로 추가되었습니다.`
          });
          onOpenChange(false);
        } catch (error) {
            console.error("Firestore write failed:", error);
            toast({
              variant: 'destructive',
              title: '저장 실패',
              description: '에피소드 정보를 Firestore에 저장하는 데 실패했습니다.',
            });
        } finally {
            setIsUploading(false);
        }
      }
    );
  };
  
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
  }

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
            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} className="col-span-3" />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="description" className="text-right">설명</Label>
            <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} className="col-span-3" />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">분류</Label>
            <div className="col-span-3 grid grid-cols-3 gap-2 items-center">
              <Select value={selectedField || ''} onValueChange={(v) => { setSelectedField(v); setSelectedClassification(null); setSelectedCourseId(null); }}>
                <SelectTrigger><SelectValue placeholder="분야" /></SelectTrigger>
                <SelectContent>{fields?.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={selectedClassification || ''} onValueChange={(v) => { setSelectedClassification(v); setSelectedCourseId(null); }} disabled={!selectedField}>
                <SelectTrigger><SelectValue placeholder="큰분류" /></SelectTrigger>
                <SelectContent>{classifications?.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={selectedCourseId || ''} onValueChange={setSelectedCourseId} disabled={!selectedClassification}>
                <SelectTrigger><SelectValue placeholder="상세분류" /></SelectTrigger>
                <SelectContent>{courses?.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <div />
            <div className="col-span-3 flex items-center space-x-2">
                <Checkbox id="isFree" checked={isFree} onCheckedChange={(checked) => setIsFree(!!checked)} />
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
                <Input id="thumbnail-file" type="file" disabled={isUploading} />
                <Button variant="secondary" size="sm" disabled={isUploading}>AI 생성</Button>
            </div>
          </div>
          {isUploading && (
            <div className="col-span-4">
              <Progress value={uploadProgress} />
              <p className="text-sm text-center text-muted-foreground mt-2">{uploadProgress.toFixed(0)}%</p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isUploading}>취소</Button>
          <Button type="submit" onClick={handleUpload} disabled={isUploading}>
            {isUploading ? '업로드 중...' : '업로드'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
