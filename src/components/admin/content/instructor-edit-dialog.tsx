'use client';

import { useEffect } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
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
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import type { Instructor } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { updateInstructor } from '@/lib/actions/instructor-actions';

const instructorFormSchema = z.object({
  name: z.string().min(2, { message: '이름은 2자 이상이어야 합니다.' }),
  email: z.string().email({ message: '유효한 이메일을 입력해주세요.' }),
  phone: z.string().regex(/^\d{3}-\d{3,4}-\d{4}$/, { message: '전화번호 형식을 확인해주세요. (010-XXXX-XXXX)' }),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: '생년월일 형식을 확인해주세요. (YYYY-MM-DD)' }),
});

type InstructorFormValues = z.infer<typeof instructorFormSchema>;

interface InstructorEditDialogProps {
  instructor: Instructor;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function InstructorEditDialog({ instructor, open, onOpenChange }: InstructorEditDialogProps) {
  const { toast } = useToast();

  const form = useForm<InstructorFormValues>({
    resolver: zodResolver(instructorFormSchema),
    defaultValues: {
      name: instructor.name || '',
      email: instructor.email || '',
      phone: instructor.phone || '',
      dob: instructor.dob || '',
    },
  });

  useEffect(() => {
    if (instructor) {
        form.reset({
            name: instructor.name || '',
            email: instructor.email || '',
            phone: instructor.phone || '',
            dob: instructor.dob || '',
        });
    }
  }, [instructor, form, open]);

  const onSubmit: SubmitHandler<InstructorFormValues> = async (data) => {
    try {
      const result = await updateInstructor({
        id: instructor.id,
        name: data.name,
        email: data.email,
        phone: data.phone,
        dob: data.dob,
      });

      if (result.success) {
        toast({
          title: '성공',
          description: result.message,
        });
        onOpenChange(false);
      } else {
        throw new Error(result.message);
      }
    } catch (error: any) {
      console.error('Error updating instructor:', error);
      toast({
        variant: 'destructive',
        title: '오류',
        description: `강사 정보 업데이트 중 오류가 발생했습니다: ${error.message}`,
      });
    }
  };

    const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>, field: any) => {
        const value = e.target.value.replace(/\D/g, '');
        let formattedValue = value;
        if (value.length > 3 && value.length <= 7) {
            formattedValue = `${value.slice(0, 3)}-${value.slice(3)}`;
        } else if (value.length > 7) {
            formattedValue = `${value.slice(0, 3)}-${value.slice(3, 7)}-${value.slice(7, 11)}`;
        }
        field.onChange(formattedValue);
    };

    const handleDobChange = (e: React.ChangeEvent<HTMLInputElement>, field: any) => {
        const value = e.target.value.replace(/\D/g, '');
        let formattedValue = value;
        if (value.length > 4 && value.length <= 6) {
            formattedValue = `${value.slice(0, 4)}-${value.slice(4)}`;
        } else if (value.length > 6) {
            formattedValue = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
        }
        field.onChange(formattedValue);
    };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>강사 정보 수정</DialogTitle>
          <DialogDescription>
            {instructor.name} 강사님의 정보를 수정합니다.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>이름</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>이메일</FormLabel>
                  <FormControl>
                    <Input type="email" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
             <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>연락처</FormLabel>
                  <FormControl>
                    <Input 
                        placeholder="010-1234-5678" 
                        {...field}
                        onChange={(e) => handlePhoneChange(e, field)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="dob"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>생년월일</FormLabel>
                  <FormControl>
                    <Input 
                      placeholder="YYYY-MM-DD" 
                      {...field}
                      onChange={(e) => handleDobChange(e, field)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter className="pt-4">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
                <Button type="submit" disabled={form.formState.isSubmitting}>
                    {form.formState.isSubmitting ? '저장 중...' : '저장'}
                </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
