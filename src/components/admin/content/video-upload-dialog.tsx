
'use client';

import { useState, useEffect, useTransition, useMemo } from 'react';
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
import { useCollection, useFirestore } from '@/firebase';
import { collection, doc, addDoc } from 'firebase/firestore';
import type { Field, Classification, Course, Episode } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { v4 as uuidv4 } from 'uuid';
import { Separator } from '@/components/ui/separator';
import { PlusCircle } from 'lucide-react';
import HierarchyItemDialog, { type HierarchyItem } from './hierarchy-item-dialog';
import { uploadEpisode } from '@/lib/actions/upload-episode';
import { updateDoc } from 'firebase/firestore';

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
  
  const [uploadProgress, setUploadProgress] = useState(0); // Not used with server action, but kept for potential future use
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

  const isEditMode = !!episode;

  const fieldsQuery = useMemo(() => (firestore ? collection(firestore, 'fields') : null), [firestore]);
  const { data: dbFields } = useCollection<Field>(fieldsQuery);

  const classificationsQuery = useMemo(() => (firestore ? collection(firestore, 'classifications') : null), [firestore]);
  const { data: dbClassifications } = useCollection<Classification>(classificationsQuery);

  const coursesQuery = useMemo(() => (firestore ? collection(firestore, 'courses') : null), [firestore]);
  const { data: dbCourses } = useCollection<Course>(coursesQuery);

  const filteredClassifications = useMemo(() => dbClassifications?.filter(c => c.fieldId === selectedFieldId) || [], [dbClassifications, selectedFieldId]);
  const filteredCourses = useMemo(() => dbCourses?.filter(c => c.classificationId === selectedClassificationId) || [], [dbCourses, selectedClassificationId]);

  useEffect(() => {
    if (open && isEditMode && episode) {
        setTitle(episode.title);
        setDescription(episode.description || '');
        setIsFree(episode.isFree);
        setSelectedCourseId(episode.courseId);
        
        const course = dbCourses?.find(c => c.id === episode.courseId);
        if (course) {
            setSelectedClassificationId(course.classificationId);
            const classification = dbClassifications?.find(c => c.id === course.classificationId);
            if (classification) {
                setSelectedFieldId(classification.fieldId);
            }
        }
    } else if (!open) {
        resetForm();
    }
}, [open, episode, isEditMode, dbCourses, dbClassifications]);

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
  };

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

    setIsUploading(true);

    try {
        if (isEditMode && episode) { // Update existing episode metadata
            const episodeRef = doc(firestore, 'courses', episode.courseId, 'episodes', episode.id);
            const updatedData = { title, description, isFree, courseId: selectedCourseId };
            // Note: Video file replacement is not handled in edit mode for simplicity.
            await updateDoc(episodeRef, updatedData);
            toast({ title: '수정 완료', description: `'${title}' 에피소드 정보가 업데이트되었습니다.` });

        } else if (videoFile) { // Create new episode via Server Action
            const formData = new FormData();
            formData.append('title', title);
            formData.append('description', description);
            formData.append('isFree', String(isFree));
            formData.append('selectedCourseId', selectedCourseId!);
            formData.append('videoFile', videoFile);

            const result = await uploadEpisode(formData);
            if (result.success) {
                toast({ title: '업로드 성공', description: result.message });
            } else {
                throw new Error(result.message);
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

  const handleSaveHierarchy = async (item: HierarchyItem) => {
    if (!firestore) return;
    const { type } = hierarchyDialogState;
    const newId = uuidv4();

    setIsUploading(true);
    startTransition(async () => {
        try {
            if (type === '분야') {
                const newItem: Omit<Field, 'id'> = { name: item.name, thumbnailUrl: `https://picsum.photos/seed/${newId}/100/100`, thumbnailHint: 'placeholder' };
                const docRef = await addDoc(collection(firestore, 'fields'), newItem);
                setSelectedFieldId(docRef.id);
                setSelectedClassificationId(null);
                setSelectedCourseId(null);
            } else if (type === '큰분류' && selectedFieldId) {
                const newItem: Omit<Classification, 'id'> = {
                    name: item.name, 
                    fieldId: selectedFieldId,
                    description: "새로운 분류 설명", 
                    prices: { day1: 0, day30: 0, day60: 0, day90: 0 },
                    thumbnailUrl: `https://picsum.photos/seed/${newId}/100/100`,
                    thumbnailHint: 'placeholder'
                };
                const docRef = await addDoc(collection(firestore, 'classifications'), newItem);
                setSelectedClassificationId(docRef.id);
                setSelectedCourseId(null);
            } else if (type === '상세분류' && selectedClassificationId) {
                const newItem: Omit<Course, 'id'> = { 
                    name: item.name,
                    classificationId: selectedClassificationId,
                    description: "새로운 상세분류 설명",
                    thumbnailUrl: `https://picsum.photos/seed/${newId}/600/400`,
                    thumbnailHint: 'placeholder image'
                };
                const docRef = await addDoc(collection(firestore, 'courses'), newItem);
                setSelectedCourseId(docRef.id);
            }
             toast({ title: '저장 완료', description: `'${item.name}' 항목이 성공적으로 추가되었습니다.` });
        } catch (e) {
            toast({ variant: 'destructive', title: '저장 실패', description: `항목 추가 중 오류가 발생했습니다.` });
        } finally {
            setIsUploading(false);
            closeHierarchyDialog();
        }
    });
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[625px]">
          <DialogHeader>
            <DialogTitle className="font-headline">{isEditMode ? '에피소드 수정' : '비디오 업로드'}</DialogTitle>
            <DialogDescription>
              {isEditMode ? '에피소드 정보를 수정합니다.' : '새 에피소드를 추가합니다. 썸네일은 비디오에서 자동으로 생성됩니다.'}
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
                    {dbFields?.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                    <Separator className="my-1" />
                    <Button variant="ghost" className="w-full justify-start h-8 px-2" onClick={(e) => {e.preventDefault(); openHierarchyDialog('분야')}}>
                        <PlusCircle className="mr-2 h-4 w-4" /> 새로 추가...
                    </Button>
                  </SelectContent>
                </Select>
                <Select value={selectedClassificationId || ''} onValueChange={(v) => { setSelectedClassificationId(v); setSelectedCourseId(null); }} disabled={!selectedFieldId || isUploading}>
                  <SelectTrigger><SelectValue placeholder="큰분류" /></SelectTrigger>
                  <SelectContent>
                    {filteredClassifications?.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    <Separator className="my-1" />
                    <Button variant="ghost" className="w-full justify-start h-8 px-2" onClick={(e) => {e.preventDefault(); openHierarchyDialog('큰분류')}} disabled={!selectedFieldId}>
                        <PlusCircle className="mr-2 h-4 w-4" /> 새로 추가...
                    </Button>
                  </SelectContent>
                </Select>
                <Select value={selectedCourseId || ''} onValueChange={setSelectedCourseId} disabled={!selectedClassificationId || isUploading}>
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
                  <Checkbox id="isFree" checked={isFree} onCheckedChange={(checked) => setIsFree(!!checked)} disabled={isUploading} />
                  <Label htmlFor="isFree">무료 콘텐츠</Label>
              </div>
            </div>
            {!isEditMode && (
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
            )}
            {isUploading && (
              <div className="col-span-full mt-2">
                <Progress value={uploadProgress} />
                <p className="text-sm text-center text-muted-foreground mt-2">
                  {isEditMode ? '저장 중...' : `업로드 중... ${uploadProgress.toFixed(0)}%`}
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isUploading}>취소</Button>
            <Button type="button" onClick={handleSaveEpisode} disabled={isUploading || isPending || (isEditMode ? false : !videoFile) || !selectedCourseId }>
              {isUploading ? '저장 중...' : '에피소드 저장'}
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
