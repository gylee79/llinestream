
'use client';

import { useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import Image from 'next/image';
import { ScrollArea } from '../ui/scroll-area';

interface CourseImagesDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  images: string[];
  courseName: string;
}

export default function CourseImagesDialog({ isOpen, onOpenChange, images, courseName }: CourseImagesDialogProps) {

  useEffect(() => {
    const viewport = document.querySelector("meta[name=viewport]");
    if (!viewport) return;
    
    const originalContent = viewport.getAttribute("content");

    if (isOpen) {
      // Allow scaling when dialog is open
      viewport.setAttribute("content", "width=device-width, initial-scale=1.0, maximum-scale=5.0, user-scalable=yes");
    } else {
      // Revert to original or default when dialog is closed
      viewport.setAttribute("content", originalContent || "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no");
    }

    // Cleanup function to restore original content on component unmount
    return () => {
      if (originalContent) {
        viewport.setAttribute("content", originalContent);
      }
    };
  }, [isOpen]);

  if (!images || images.length === 0) {
    return null;
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[90vw] md:max-w-4xl h-[90vh] flex flex-col p-0">
        <DialogHeader className="p-4 border-b flex-shrink-0">
          <DialogTitle>{courseName} 상세 정보</DialogTitle>
        </DialogHeader>
        <ScrollArea className="flex-grow min-h-0">
            <div className="p-4 md:p-6" style={{ touchAction: 'pan-y' }}>
                {images.map((url, index) => (
                    <div key={index} className="relative w-full h-auto mb-4">
                        <Image 
                            src={url} 
                            alt={`상세 정보 이미지 ${index + 1}`} 
                            width={1200}
                            height={1200}
                            sizes="100vw"
                            className="w-full h-auto object-contain rounded-md"
                        />
                    </div>
                ))}
            </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
