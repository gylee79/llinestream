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
import { Textarea } from '@/components/ui/textarea';

export interface HierarchyItem {
  id: string;
  name: string;
  description?: string;
}

interface HierarchyItemDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (item: HierarchyItem) => void;
  item: HierarchyItem | null;
  itemType: '분야' | '큰분류' | '상세분류';
}

export default function HierarchyItemDialog({
  isOpen,
  onClose,
  onSave,
  item,
  itemType,
}: HierarchyItemDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  
  const dialogTitle = item ? `${itemType} 수정` : `새 ${itemType} 추가`;
  const dialogDescription = item
    ? `'${item.name}'의 이름 또는 설명을 수정합니다.`
    : `새로운 ${itemType}의 이름과 설명을 입력해주세요.`;
    
  const showDescription = itemType === '큰분류' || itemType === '상세분류';

  useEffect(() => {
    if (isOpen) {
      setName(item?.name || '');
      if (showDescription) {
        setDescription(item?.description || '');
      }
    }
  }, [isOpen, item, showDescription]);
  
  const handleSave = () => {
    if (!name.trim()) return;
    onSave({ id: item?.id || '', name, description });
  };
  
  const handleSafeClose = () => {
    setTimeout(onClose, 150);
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleSafeClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogDescription>{dialogDescription}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="name" className="text-right">
              이름
            </Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="col-span-3"
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
            />
          </div>
          {showDescription && (
            <div className="grid grid-cols-4 items-start gap-4">
                <Label htmlFor="description" className="text-right pt-2">
                    설명
                </Label>
                <Textarea
                    id="description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="col-span-3"
                    rows={3}
                />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleSafeClose}>
            취소
          </Button>
          <Button onClick={handleSave}>저장</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
