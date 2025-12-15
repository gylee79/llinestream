'use client';

import { useState, useEffect, useTransition } from 'react';
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
import { useCollection, useFirestore, useStorage } from '@/firebase';
import { collection, query, where, doc, setDoc, writeBatch } from 'firebase/firestore';
import type { Field, Classification, Course, Episode } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { v4 as uuidv4 } from 'uuid';
import { Separator } from '@/components/ui/separator';
import { PlusCircle } from 'lucide-react';
import HierarchyItemDialog, { type HierarchyItem } from './hierarchy-item-dialog';

interface VideoUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type HierarchyDialogState = {
  isOpen: boolean;
  item: HierarchyItem | null;
  type: '분야' | '큰분류' | '상세분류';
};

type NewHierarchyItems = {
  fields: Field[];
  classifications: Classification[];
  courses: Course[];
};

export default function VideoUploadDialog({ open, onOpenChange }: VideoUploadDialogProps) {
  const firestore = useFirestore();
  const storage = useStorage();
  const { toast } = useToast();
  
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isFree, setIsFree] = useState(false);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [selectedClassificationId, setSelectedClassificationId] = useState<string | null>(null);
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);

  const [hierarchyDialogState, setHierarchyDialogState] = useState<HierarchyDialogState>({ isOpen: false, item: null, type: '분야' });
  const [isPending, startTransition] = useTransition();

  // Firestore data
  const { data: dbFields } = useCollection<Field>(collection(firestore, 'fields'));
  const { data: dbClassifications } = useCollection<Classification>(collection(firestore, 'classifications'));
  const { data: dbCourses } = useCollection<Course>(collection(firestore, 'courses'));
  
  // Local state for temporary items
  const [newHierarchyItems, setNewHierarchyItems] = useState<NewHierarchyItems>({
    fields: [],
    classifications: [],
    courses: [],
  });

  // Combined data (DB + local)
  const allFields = [...(dbFields || []), ...newHierarchyItems.fields];
  const allClassifications = [...(dbClassifications || []), ...newHierarchyItems.classifications];
  const allCourses = [...(dbCourses || []), ...newHierarchyItems.courses];

  const filteredClassifications = allClassifications.filter(c => c.fieldId === selectedFieldId);
  const filteredCourses = allCourses.filter(c => c.classificationId === selectedClassificationId);

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setIsFree(false);
    setSelectedFieldId(null);
    setSelectedClassificationId(null);
    setSelectedCourseId(null);
    setVideoFile(null);
    setUploadProgress(0);
    setIsUploading(false);
    setNewHierarchyItems({ fields: [], classifications: [], courses: [] });
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

      const downloadUrl = await new Promise<string>((resolve, reject) => {
        uploadTask.on('state_changed',
          (snapshot) => setUploadProgress((snapshot.bytesTransferred / snapshot.totalBytes) * 100),
          (error) => reject(new Error('파일 스토리지 업로드에 실패했습니다. CORS나 Storage 규칙을 확인해주세요.')),
          async () => resolve(await getDownloadURL(uploadTask.snapshot.ref))
        );
      });
      
      // 3. Save everything to Firestore in a batch
      const batch = writeBatch(firestore);

      // Add new hierarchy items
      newHierarchyItems.fields.forEach(item => batch.set(doc(firestore, 'fields', item.id), item));
      newHierarchyItems.classifications.forEach(item => batch.set(doc(firestore, 'classifications', item.id), item));
      newHierarchyItems.courses.forEach(item => batch.set(doc(firestore, 'courses', item.id), item));

      // Add the new episode
      const newEpisodeDocRef = doc(firestore, 'courses', selectedCourseId, 'episodes', episodeId);
      const newEpisode: Omit<Episode, 'id'> = {
          courseId: selectedCourseId,
          title,
          description,
          duration,
          isFree,
          videoUrl: downloadUrl,
      };
      batch.set(newEpisodeDocRef, newEpisode);

      await batch.commit();

      toast({
        title: '업로드 완료',
        description: `${title} 에피소드가 성공적으로 추가되었습니다.`
      });
      onOpenChange(false);

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

  const openHierarchyDialog = (type: HierarchyDialogState['type']) => {
    if ((type === '큰분류' && !selectedFieldId) || (type === '상세분류' && !selectedClassificationId)) {
      toast({ variant: 'destructive', title: '오류', description: '상위 계층을 먼저 선택해주세요.' });
      return;
    }
    setHierarchyDialogState({ isOpen: true, item: null, type });
  };
  const closeHierarchyDialog = () => setHierarchyDialogState({ isOpen: false, item: null, type: '분야' });

  const handleSaveHierarchy = (item: HierarchyItem) => {
    const { type } = hierarchyDialogState;
    const newId = uuidv4();

    startTransition(() => {
        if (type === '분야') {
            const newItem: Field = { id: newId, name: item.name };
            setNewHierarchyItems(prev => ({ ...prev, fields: [...prev.fields, newItem] }));
            setSelectedFieldId(newId);
            setSelectedClassificationId(null);
            setSelectedCourseId(null);
        } else if (type === '큰분류' && selectedFieldId) {
            const newItem: Classification = { 
                id: newId, 
                name: item.name, 
                fieldId: selectedFieldId,
                description: "새로운 분류 설명", 
                prices: { day1: 0, day30: 0, day60: 0, day90: 0 } 
            };
            setNewHierarchyItems(prev => ({ ...prev, classifications: [...prev.classifications, newItem] }));
            setSelectedClassificationId(newId);
            setSelectedCourseId(null);
        } else if (type === '상세분류' && selectedClassificationId) {
            const newItem: Course = { 
                id: newId, 
                name: item.name,
                classificationId: selectedClassificationId,
                description: "새로운 상세분류 설명",
                thumbnailUrl: `https://picsum.photos/seed/${newId}/600/400`,
                thumbnailHint: 'placeholder image'
            };
            setNewHierarchyItems(prev => ({ ...prev, courses: [...prev.courses, newItem] }));
            setSelectedCourseId(newId);
        }
    });

    toast({ title: '임시 저장됨', description: `'${item.name}' 항목이 추가되었습니다. 최종 저장을 위해 '에피소드 저장' 버튼을 눌러주세요.` });
    closeHierarchyDialog();
  };

  useEffect(() => {
    if (!open) {
      resetForm();
    }
  }, [open]);

  return (
    <>
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
            <div className="grid grid-cols-4 items-start gap-4">
              <Label htmlFor="description" className="text-right pt-2">설명</Label>
              <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} className="col-span-3" disabled={isUploading} />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">분류</Label>
              <div className="col-span-3 grid grid-cols-3 gap-2 items-center">
                <Select value={selectedFieldId || ''} onValueChange={(v) => { setSelectedFieldId(v); setSelectedClassificationId(null); setSelectedCourseId(null); }} disabled={isUploading}>
                  <SelectTrigger><SelectValue placeholder="분야" /></SelectTrigger>
                  <SelectContent>
                    {allFields?.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                    <Separator className="my-1" />
                    <Button variant="ghost" className="w-full justify-start h-8 px-2" onClick={() => openHierarchyDialog('분야')}>
                        <PlusCircle className="mr-2 h-4 w-4" /> 새로 추가...
                    </Button>
                  </SelectContent>
                </Select>
                <Select value={selectedClassificationId || ''} onValueChange={(v) => { setSelectedClassificationId(v); setSelectedCourseId(null); }} disabled={!selectedFieldId || isUploading}>
                  <SelectTrigger><SelectValue placeholder="큰분류" /></SelectTrigger>
                  <SelectContent>
                    {filteredClassifications?.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    <Separator className="my-1" />
                    <Button variant="ghost" className="w-full justify-start h-8 px-2" onClick={() => openHierarchyDialog('큰분류')} disabled={!selectedFieldId}>
                        <PlusCircle className="mr-2 h-4 w-4" /> 새로 추가...
                    </Button>
                  </SelectContent>
                </Select>
                <Select value={selectedCourseId || ''} onValueChange={setSelectedCourseId} disabled={!selectedClassificationId || isUploading}>
                  <SelectTrigger><SelectValue placeholder="상세분류" /></SelectTrigger>
                  <SelectContent>
                    {filteredCourses?.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    <Separator className="my-1" />
                    <Button variant="ghost" className="w-full justify-start h-8 px-2" onClick={() => openHierarchyDialog('상세분류')} disabled={!selectedClassificationId}>
                        <PlusCircle className="mr-2 h-4 w-4" /> 새로 추가...
                    </Button>
                  </SelectContent>
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
              <div className="col-span-full mt-2">
                <Progress value={uploadProgress} />
                <p className="text-sm text-center text-muted-foreground mt-2">
                  {uploadProgress < 100 ? `업로드 중... ${uploadProgress.toFixed(0)}%` : '업로드 완료, 처리 중...'}
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isUploading}>취소</Button>
            <Button type="button" onClick={handleSaveEpisode} disabled={isUploading || !videoFile || !selectedCourseId || isPending}>
              {isUploading ? '저장 중...' : isPending ? '분류 적용 중...' : '에피소드 저장'}
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
