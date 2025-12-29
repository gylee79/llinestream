
'use client';

import { useState, useEffect } from 'react';
import { useParams, notFound, useRouter } from 'next/navigation';
import { useDoc, useFirestore, useMemoFirebase } from '@/firebase';
import { doc, updateDoc } from 'firebase/firestore';
import type { Course } from '@/lib/types';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import Image from 'next/image';
import { ArrowLeft, GripVertical, ImageUp, Trash2, UploadCloud } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Separator } from '@/components/ui/separator';
import { updateCourse } from '@/lib/actions/update-course';
import { Reorder } from 'framer-motion';
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
import { v4 as uuidv4 } from 'uuid';

const courseSchema = z.object({
  name: z.string().min(2, { message: '강좌 이름은 2자 이상이어야 합니다.' }),
  description: z.string().min(10, { message: '설명은 10자 이상이어야 합니다.' }),
});

type CourseFormValues = z.infer<typeof courseSchema>;

interface ImageItem {
  id: string; // Used for reordering key
  url: string;
  isNew: boolean;
  file?: File;
}

export default function CourseEditPage() {
  const params = useParams<{ courseId: string }>();
  const router = useRouter();
  const firestore = useFirestore();
  const { toast } = useToast();

  const courseRef = useMemoFirebase(() => firestore ? doc(firestore, 'courses', params.courseId as string) : null, [firestore, params.courseId]);
  const { data: course, isLoading: courseLoading } = useDoc<Course>(courseRef);

  const [images, setImages] = useState<ImageItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  const form = useForm<CourseFormValues>({
    resolver: zodResolver(courseSchema),
  });

  useEffect(() => {
    if (course) {
      form.reset({
        name: course.name,
        description: course.description,
      });
      const existingImages = (course.introImageUrls || []).map(url => ({ id: uuidv4(), url, isNew: false }));
      setImages(existingImages);
    }
  }, [course, form]);

  if (courseLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-96 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!course) {
    notFound();
  }

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      const newFiles = Array.from(event.target.files).map(file => {
        const localUrl = URL.createObjectURL(file);
        return { id: uuidv4(), url: localUrl, isNew: true, file };
      });
      setImages(prev => [...prev, ...newFiles]);
    }
  };
  
  const handleRemoveImage = (idToRemove: string) => {
    const imageToRemove = images.find(img => img.id === idToRemove);
    if(imageToRemove && !imageToRemove.isNew) {
        // For existing images, we just mark them for deletion on the server
        // Here, we just remove from local state. The server action will handle the logic.
    }
    // Clean up local blob URL
    if (imageToRemove?.isNew) {
      URL.revokeObjectURL(imageToRemove.url);
    }
    setImages(prev => prev.filter(img => img.id !== idToRemove));
  };


  const onSubmit = async (data: CourseFormValues) => {
    if (!course) return;
    setIsProcessing(true);

    try {
      const newFiles = images.filter(img => img.isNew && img.file).map(img => img.file!);
      const existingImageUrls = images.filter(img => !img.isNew).map(img => img.url);

      const result = await updateCourse({
        courseId: course.id,
        name: data.name,
        description: data.description,
        existingImageUrls: existingImageUrls,
        newFiles,
      });

      if (result.success) {
        toast({ title: "성공", description: "강좌 정보가 성공적으로 업데이트되었습니다." });
        router.push('/admin/content'); // Or refresh the page
      } else {
        throw new Error(result.message);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
      toast({ variant: "destructive", title: "업데이트 실패", description: message });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div>
      <Button variant="ghost" onClick={() => router.back()} className="mb-4">
        <ArrowLeft className="mr-2 h-4 w-4" />
        뒤로가기
      </Button>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <Card>
          <CardHeader>
            <CardTitle>강좌 정보 수정</CardTitle>
            <CardDescription>&apos;{course.name}&apos; 강좌의 기본 정보와 소개 이미지를 관리합니다.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="name">강좌 이름</Label>
              <Input id="name" {...form.register('name')} />
              {form.formState.errors.name && <p className="text-sm text-destructive">{form.formState.errors.name.message}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">강좌 설명</Label>
              <Textarea id="description" {...form.register('description')} rows={5} />
              {form.formState.errors.description && <p className="text-sm text-destructive">{form.formState.errors.description.message}</p>}
            </div>
          </CardContent>
        </Card>

        <Separator className="my-8" />

        <Card>
          <CardHeader>
            <CardTitle>소개 이미지 관리</CardTitle>
            <CardDescription>클래스101처럼 강좌를 상세히 소개하는 여러 이미지를 추가, 삭제, 재정렬할 수 있습니다.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="p-4 border-2 border-dashed rounded-lg text-center">
                <UploadCloud className="mx-auto h-12 w-12 text-muted-foreground" />
                <Label htmlFor="image-upload" className="mt-2 block text-sm font-medium text-primary hover:underline cursor-pointer">
                  파일 선택
                </Label>
                <Input id="image-upload" type="file" multiple onChange={handleFileChange} className="hidden" />
                 <p className="mt-1 text-xs text-muted-foreground">드래그 앤 드롭 또는 파일 선택으로 여러 이미지를 추가하세요.</p>
              </div>
              
              <Reorder.Group axis="y" values={images} onReorder={setImages} className="space-y-2">
                  {images.map(image => (
                      <Reorder.Item key={image.id} value={image} className="bg-muted p-2 rounded-lg flex items-center gap-4 group">
                          <GripVertical className="h-5 w-5 text-muted-foreground cursor-grab" />
                          <div className="relative w-40 h-24 rounded-md overflow-hidden">
                              <Image src={image.url} alt="소개 이미지" fill className="object-cover" />
                          </div>
                          <div className="flex-1 text-sm text-muted-foreground truncate">
                              {image.isNew ? image.file?.name : '기존 이미지'}
                          </div>
                          <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="ghost" size="icon" className="text-destructive opacity-50 group-hover:opacity-100">
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                  <AlertDialogHeader>
                                      <AlertDialogTitle>이미지를 삭제하시겠습니까?</AlertDialogTitle>
                                      <AlertDialogDescription>이 작업은 되돌릴 수 없습니다. 이미지가 목록에서 제거됩니다.</AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                      <AlertDialogCancel>취소</AlertDialogCancel>
                                      <AlertDialogAction onClick={() => handleRemoveImage(image.id)} className="bg-destructive hover:bg-destructive/90">삭제</AlertDialogAction>
                                  </AlertDialogFooter>
                              </AlertDialogContent>
                          </AlertDialog>
                      </Reorder.Item>
                  ))}
              </Reorder.Group>
            </div>
          </CardContent>
        </Card>
        
        <div className="mt-8 flex justify-end">
            <Button type="submit" disabled={isProcessing}>
                {isProcessing ? '저장 중...' : '변경사항 저장'}
            </Button>
        </div>
      </form>
    </div>
  );
}
