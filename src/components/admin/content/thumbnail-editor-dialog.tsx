
'use client';

import { useState, useEffect, useCallback } from 'react';
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
import type { Field, Classification, Course, Episode } from '@/lib/types';
import { updateThumbnail } from '@/lib/actions/update-thumbnail';
import { ImageIcon, Trash2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface ThumbnailEditorDialogProps {
  isOpen: boolean;
  onClose: () => void;
  item: (Field | Classification | Course | Episode);
  itemType: 'fields' | 'classifications' | 'courses' | 'episodes';
}

export default function ThumbnailEditorDialog({ isOpen, onClose, item, itemType }: ThumbnailEditorDialogProps) {
  const { toast } = useToast();
  const [isProcessing, setIsProcessing] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(item.thumbnailUrl || null);

  const resetState = useCallback(() => {
    setImagePreview(item.thumbnailUrl || null);
    setImageFile(null);
    setIsProcessing(false);
  }, [item.thumbnailUrl]);

  useEffect(() => {
    if (isOpen) {
        resetState();
    }
  }, [isOpen, resetState]);

  const handleSafeClose = () => {
    if (isProcessing) return;
    onClose();
    setTimeout(resetState, 150);
  };

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
  
  const handleCancelFile = () => {
    setImageFile(null);
    setImagePreview(item.thumbnailUrl || null); // Revert to original
  }

  const handleSave = async () => {
    if (!item || !imageFile) {
        toast({ variant: 'destructive', title: '오류', description: '새로운 이미지 파일을 선택해주세요.' });
        return;
    }

    setIsProcessing(true);
    
    try {
        const reader = new FileReader();
        const base64Image = await new Promise<string>((resolve, reject) => {
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = (error) => reject(error);
            reader.readAsDataURL(imageFile);
        });


        const result = await updateThumbnail({
            itemType,
            itemId: item.id,
            base64Image,
            imageContentType: imageFile.type,
            imageName: imageFile.name,
        });
        
        if (result.success) {
            toast({ title: '저장 성공', description: '썸네일 정보가 성공적으로 업데이트되었습니다.' });
            handleSafeClose();
        } else {
            throw new Error(result.message);
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
        toast({ variant: 'destructive', title: '저장 실패', description: errorMessage });
    } finally {
        setIsProcessing(false);
    }
  };

  const handleDelete = async () => {
     if (!item) return;

    setIsProcessing(true);
    try {
        const result = await updateThumbnail({
            itemType,
            itemId: item.id,
            base64Image: null, // Sending null indicates deletion
        });

        if (result.success) {
            toast({ title: '삭제 성공', description: '썸네일이 삭제되었습니다.' });
            handleSafeClose();
        } else {
            throw new Error(result.message);
        }
    } catch (error) {
         const errorMessage = error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
        toast({ variant: 'destructive', title: '삭제 실패', description: errorMessage });
    } finally {
        setIsProcessing(false);
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleSafeClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>썸네일 수정: {(item as any).name || (item as Episode).title}</DialogTitle>
          <DialogDescription>
            썸네일 이미지를 수정합니다.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>썸네일 미리보기</Label>
            <div className="relative w-full aspect-video rounded-md overflow-hidden bg-muted border">
                {imagePreview ? (
                    <Image src={imagePreview} alt="썸네일 미리보기" fill sizes="400px" className="object-cover" />
                ) : (
                    <div className="flex items-center justify-center h-full w-full">
                        <ImageIcon className="h-10 w-10 text-muted-foreground" />
                    </div>
                )}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="thumbnail-file">새 이미지 업로드</Label>
            <div className="flex gap-2">
                <Input id="thumbnail-file" type="file" accept="image/*" onChange={handleFileChange} disabled={isProcessing} className="flex-1" />
                {imageFile && <Button variant="outline" onClick={handleCancelFile}>취소</Button>}
            </div>
          </div>
        </div>
        <DialogFooter className="justify-between">
           <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" disabled={isProcessing || !imagePreview}>
                    <Trash2 className="mr-2 h-4 w-4" /> 삭제
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>정말 썸네일을 삭제하시겠습니까?</AlertDialogTitle>
                  <AlertDialogDescription>
                    이 작업은 되돌릴 수 없으며, 썸네일이 기본 이미지로 초기화됩니다.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>취소</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDelete} className="bg-destructive hover:bg-destructive/90">삭제</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleSafeClose} disabled={isProcessing}>
                취소
            </Button>
            <Button onClick={handleSave} disabled={isProcessing || !imageFile}>
                {isProcessing ? '저장 중...' : '저장'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
