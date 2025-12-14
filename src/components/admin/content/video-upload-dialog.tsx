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
import { useCollection, useFirestore, useMemoFirebase } from '@/firebase';
import { collection, query, where } from 'firebase/firestore';
import type { Field, Classification, Course } from '@/lib/types';


interface VideoUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function VideoUploadDialog({ open, onOpenChange }: VideoUploadDialogProps) {
  const firestore = useFirestore();
  
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [isFree, setIsFree] = useState(false);
  
  const [selectedField, setSelectedField] = useState<string | null>(null);
  const [selectedClassification, setSelectedClassification] = useState<string | null>(null);

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

  const handleUpload = () => {
    setIsUploading(true);
    const interval = setInterval(() => {
      setUploadProgress(prev => {
        if (prev >= 100) {
          clearInterval(interval);
          setIsUploading(false);
          onOpenChange(false);
          return 100;
        }
        return prev + 10;
      });
    }, 200);
  };
  
  useEffect(() => {
    if (!open) {
      setUploadProgress(0);
      setIsUploading(false);
      setIsFree(false);
      setSelectedField(null);
      setSelectedClassification(null);
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
            <Input id="title" className="col-span-3" />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="description" className="text-right">설명</Label>
            <Textarea id="description" className="col-span-3" />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">분류</Label>
            <div className="col-span-3 grid grid-cols-3 gap-2 items-center">
              <Select onValueChange={setSelectedField} disabled={isFree}>
                <SelectTrigger><SelectValue placeholder="분야" /></SelectTrigger>
                <SelectContent>{fields?.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}</SelectContent>
              </Select>
              <Select onValueChange={setSelectedClassification} disabled={isFree || !selectedField}>
                <SelectTrigger><SelectValue placeholder="큰분류" /></SelectTrigger>
                <SelectContent>{classifications?.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
              <Select disabled={isFree || !selectedClassification}>
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
            <Input id="video-file" type="file" className="col-span-3" />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="thumbnail-file" className="text-right">썸네일</Label>
            <div className="col-span-3 flex items-center gap-2">
                <Input id="thumbnail-file" type="file" />
                <Button variant="secondary" size="sm">AI 생성</Button>
            </div>
          </div>
          {isUploading && (
            <div className="col-span-4">
              <Progress value={uploadProgress} />
              <p className="text-sm text-center text-muted-foreground mt-2">{uploadProgress}%</p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
          <Button type="submit" onClick={handleUpload} disabled={isUploading}>
            {isUploading ? '업로드 중...' : '업로드'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
