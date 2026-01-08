'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from '@/components/ui/dialog';
import Image from 'next/image';
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { X } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';

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
      <DialogContent className="max-w-[90vw] md:max-w-4xl h-[90vh] flex flex-col p-0 bg-muted/80 backdrop-blur-sm">
        <DialogHeader className="p-4 border-b flex-shrink-0 bg-background z-10 flex flex-row justify-between items-center">
          <DialogTitle>{courseName} 상세 정보</DialogTitle>
          <DialogClose className="rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </DialogClose>
        </DialogHeader>
        
        <ScrollArea className="flex-grow min-h-0 w-full h-full">
            <div className="p-4 md:p-6 flex flex-col items-center">
                {images.map((url, index) => (
                    <TransformWrapper key={index} initialScale={1} minScale={1} maxScale={4}>
                        <TransformComponent
                          wrapperStyle={{ marginBottom: '1rem', maxWidth: '100%', width: '100%' }}
                          contentStyle={{ width: '100%', height: '100%' }}
                        >
                            <Image 
                                src={url} 
                                alt={`상세 정보 이미지 ${index + 1}`} 
                                width={1200}
                                height={1600} 
                                className="w-full h-auto object-contain"
                                sizes="(max-width: 768px) 90vw, 1200px"
                                priority={index === 0}
                            />
                        </TransformComponent>
                    </TransformWrapper>
                ))}
            </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
