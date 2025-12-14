'use client';

import { useState } from 'react';
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { fields, classifications, courses } from '@/lib/data';
import { Plus } from 'lucide-react';

interface VideoUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function VideoUploadDialog({ open, onOpenChange }: VideoUploadDialogProps) {
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [isFree, setIsFree] = useState(false);
  
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
  
  const CategoryCreator = ({ type }: { type: string }) => (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon" className="h-9 w-9 ml-2">
          <Plus className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80">
        <div className="grid gap-4">
          <div className="space-y-2">
            <h4 className="font-medium leading-none">새 {type} 생성</h4>
            <p className="text-sm text-muted-foreground">
              즉석에서 새 {type}을(를) 생성합니다.
            </p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="new-category-name">이름</Label>
            <Input id="new-category-name" />
            <Button size="sm">생성</Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );

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
              <Select disabled={isFree}>
                <SelectTrigger><SelectValue placeholder="분야" /></SelectTrigger>
                <SelectContent>{fields.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}</SelectContent>
              </Select>
              <Select disabled={isFree}>
                <SelectTrigger><SelectValue placeholder="큰분류" /></SelectTrigger>
                <SelectContent>{classifications.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
              <div className="flex">
              <Select disabled={isFree}>
                <SelectTrigger><SelectValue placeholder="상세분류" /></SelectTrigger>
                <SelectContent>{courses.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
              <CategoryCreator type="상세분류" />
              </div>
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
