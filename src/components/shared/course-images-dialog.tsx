'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import Image from 'next/image';
import { ScrollArea } from '../ui/scroll-area';
// 줌 기능을 위한 라이브러리
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';

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
      <DialogContent className="max-w-[90vw] md:max-w-4xl h-[90vh] flex flex-col p-0">
        <DialogHeader className="p-4 border-b flex-shrink-0">
          <DialogTitle>{courseName} 상세 정보</DialogTitle>
        </DialogHeader>
        
        {/* 배경색을 살짝 어둡게 해서 이미지 영역 구분 */}
        <ScrollArea className="flex-grow min-h-0 bg-black/5">
          <div className="p-4 md:p-6">
            <TransformWrapper
              initialScale={1}
              minScale={1}
              maxScale={4}
              panning={{ disabled: true, excluded: ["input", "select", "textarea"] }}
            >
              {({ setPanning }) => (
                <TransformComponent wrapperStyle={{ width: "100%", height: "auto" }}>
                  <div 
                    className="flex flex-col"
                    onMouseEnter={() => setPanning(false)}
                    onMouseLeave={() => setPanning(true)}
                  >
                    {images.map((url, index) => (
                      <div key={index} className="relative w-full h-auto">
                        <Image 
                          src={url} 
                          alt={`상세 정보 이미지 ${index + 1}`} 
                          width={1200}
                          height={1200}
                          className="w-full h-auto object-contain"
                          sizes="(max-width: 768px) 100vw, 800px"
                          priority={index === 0}
                        />
                      </div>
                    ))}
                  </div>
                </TransformComponent>
              )}
            </TransformWrapper>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
