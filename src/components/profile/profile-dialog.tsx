
'use client';

import { useState, useEffect } from 'react';
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
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import type { User } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { updateUserProfileAndLog } from '@/lib/actions/user-actions';

const profileFormSchema = z.object({
  name: z.string().min(2, { message: '이름은 2자 이상이어야 합니다.' }),
  phone: z.string().regex(/^\d{3}-\d{3,4}-\d{4}$/, { message: '전화번호 형식을 확인해주세요. (010-XXXX-XXXX)' }),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: '생년월일 형식을 확인해주세요. (YYYY-MM-DD)' }),
});

type ProfileFormValues = z.infer<typeof profileFormSchema>;

interface ProfileDialogProps {
  user: User;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function ProfileDialog({ user, open, onOpenChange }: ProfileDialogProps) {
  const { toast } = useToast();

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: {
      name: user.name || '',
      phone: user.phone || '',
      dob: user.dob || '',
    },
  });
  
  useEffect(() => {
    if (user) {
        form.reset({
            name: user.name || '',
            phone: user.phone || '',
            dob: user.dob || '',
        })
    }
  }, [user, form, open]);

  const onSubmit: SubmitHandler<ProfileFormValues> = async (data) => {
    try {
      const result = await updateUserProfileAndLog({
        userId: user.id,
        currentData: {
          name: user.name,
          phone: user.phone,
          dob: user.dob,
        },
        newData: data,
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
      console.error('Error updating profile:', error);
      toast({
        variant: 'destructive',
        title: '오류',
        description: `프로필 업데이트 중 오류가 발생했습니다: ${error.message}`,
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
          <DialogTitle>프로필 수정</DialogTitle>
          <DialogDescription>
            회원님의 정보를 수정할 수 있습니다. 이메일은 변경할 수 없습니다.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
            <div className="space-y-2">
                <Label>이메일 (변경 불가)</Label>
                <Input value={user.email} disabled />
            </div>
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
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  취소
                </Button>
              </DialogClose>
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
