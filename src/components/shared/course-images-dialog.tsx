'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from '@/components/ui/carousel';
import Image from 'next/image';
import { ScrollArea } from '../ui/scroll-area';

interface CourseImagesDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  images: string[];
  courseName: string;
}

export default function CourseImagesDialog({ isOpen, onOpenChange, images, courseName }: CourseImagesDialogProps) {
  if (!images || images.length === 0) {
    return null;
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[90vh] flex flex-col p-0">
        <DialogHeader className="p-4 border-b">
          <DialogTitle>{courseName} 상세 정보</DialogTitle>
        </DialogHeader>
        <ScrollArea className="flex-1">
            <div className="p-4">
                {images.map((url, index) => (
                    <div key={index} className="relative w-full aspect-auto mb-4">
                        <Image 
                            src={url} 
                            alt={`소개 이미지 ${index + 1}`} 
                            width={1200}
                            height={800}
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
