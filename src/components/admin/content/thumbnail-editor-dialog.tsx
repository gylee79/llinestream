
'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
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
import { useToast } from '@/hooks/use-toast';
import type { Field, Classification, Course } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { updateDoc, doc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { useFirestore, useStorage } from '@/firebase';
import { revalidatePath } from 'next/cache';

interface ThumbnailEditorDialogProps {
  isOpen: boolean;
  onClose: () => void;
  item: Field | Classification | Course;
  itemType: 'fields' | 'classifications' | 'courses';
}

export default function ThumbnailEditorDialog({ isOpen, onClose, item, itemType }: ThumbnailEditorDialogProps) {
  const firestore = useFirestore();
  const storage = useStorage();
  const { toast } = useToast();
  const [isSaving, setIsSaving] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [thumbnailHint, setThumbnailHint] = useState('');

  useEffect(() => {
    if (item) {
      setImagePreview(item.thumbnailUrl);
      setThumbnailHint(item.thumbnailHint || '');
    }
    // Reset file input when dialog opens or item changes
    setImageFile(null);
  }, [item, isOpen]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImageFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSave = async () => {
    if (!item || !firestore || !storage) {
        toast({ variant: 'destructive', title: '오류', description: 'Firebase 서비스가 준비되지 않았습니다.' });
        return;
    }

    setIsSaving(true);

    try {
        const dataToUpdate: { thumbnailHint: string; thumbnailUrl?: string } = {
          thumbnailHint: thumbnailHint,
        };

        if (imageFile) {
            const storageRef = ref(storage, `${itemType}/${item.id}/${imageFile.name}`);
            const uploadResult = await uploadBytes(storageRef, imageFile);
            const downloadUrl = await getDownloadURL(uploadResult.ref);
            dataToUpdate.thumbnailUrl = downloadUrl;
        }

        const docRef = doc(firestore, itemType, item.id);
        await updateDoc(docRef, dataToUpdate);

        toast({
            title: '저장 성공',
            description: '썸네일 정보가 성공적으로 업데이트되었습니다.',
        });
        onClose();
        // Manually trigger revalidation if needed, though server actions do this better.
        // revalidatePath('/admin/content'); 
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
        toast({
            variant: 'destructive',
            title: '저장 실패',
            description: errorMessage,
        });
    } finally {
        setIsSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>썸네일 수정: {item.name}</DialogTitle>
          <DialogDescription>
            썸네일 이미지와 AI 생성 힌트를 수정합니다.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>현재 썸네일</Label>
            <div className="relative w-full aspect-video rounded-md overflow-hidden bg-muted">
                {imagePreview ? (
                    <Image src={imagePreview} alt="썸네일 미리보기" fill className="object-cover" />
                ) : (
                    <Skeleton className="h-full w-full" />
                )}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="thumbnail-file">새 이미지 업로드</Label>
            <Input id="thumbnail-file" type="file" accept="image/*" onChange={handleFileChange} disabled={isSaving} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="thumbnail-hint">AI 이미지 힌트</Label>
            <Input 
                id="thumbnail-hint" 
                value={thumbnailHint}
                onChange={e => setThumbnailHint(e.target.value)}
                placeholder="e.g. abstract code"
                disabled={isSaving}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSaving}>
            취소
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? '저장 중...' : '저장'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
