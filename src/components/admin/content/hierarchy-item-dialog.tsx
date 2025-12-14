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

export interface HierarchyItem {
  id: string;
  name: string;
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
  const dialogTitle = item ? `${itemType} 수정` : `새 ${itemType} 추가`;
  const dialogDescription = item
    ? `'${item.name}'의 이름을 수정합니다.`
    : `새로운 ${itemType}의 이름을 입력해주세요.`;

  useEffect(() => {
    if (isOpen) {
      setName(item?.name || '');
    }
  }, [isOpen, item]);

  const handleSave = () => {
    if (!name.trim()) return;
    onSave({ id: item?.id || '', name });
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
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
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            취소
          </Button>
          <Button onClick={handleSave}>저장</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
