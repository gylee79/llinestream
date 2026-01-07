'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import Image from 'next/image';
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";

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
        <DialogHeader className="p-4 border-b flex-shrink-0 bg-background z-10">
          <DialogTitle>{courseName} 상세 정보</DialogTitle>
        </DialogHeader>
        
        <div className="flex-grow min-h-0 w-full h-full">
            <TransformWrapper
                initialScale={1}
                minScale={1}
                maxScale={4}
                limitToBounds={true}
                doubleClick={{ disabled: true }}
                wheel={{ step: 0.2 }}
            >
                <TransformComponent
                    wrapperStyle={{ width: "100%", height: "100%" }}
                    contentStyle={{ width: "100%", height: "auto" }}
                >
                    <div className="p-4 md:p-6 flex flex-col items-center">
                        {images.map((url, index) => (
                        <div key={index} className="relative w-full h-auto mb-4 max-w-full">
                            <Image 
                                src={url} 
                                alt={`상세 정보 이미지 ${index + 1}`} 
                                width={1200}
                                height={1600} 
                                className="w-full h-auto object-contain"
                                sizes="(max-width: 768px) 90vw, 1200px"
                                priority={index === 0}
                            />
                        </div>
                        ))}
                    </div>
                </TransformComponent>
            </TransformWrapper>
        </div>
      </DialogContent>
    </Dialog>
  );
}
