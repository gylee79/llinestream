
'use client';

import { useState } from 'react';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
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
import { useCollection, useFirestore, useMemoFirebase } from '@/firebase';
import { collection, addDoc, serverTimestamp, query, orderBy } from 'firebase/firestore';
import type { Instructor } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import { toDisplayDate } from '@/lib/date-helpers';
import { PlusCircle } from 'lucide-react';

const instructorFormSchema = z.object({
  name: z.string().min(2, { message: '이름은 2자 이상이어야 합니다.' }),
  email: z.string().email({ message: '유효한 이메일을 입력해주세요.' }),
  phone1: z.string().length(3, { message: '3자리' }),
  phone2: z.string().min(3, { message: '3-4자리' }).max(4, { message: '3-4자리' }),
  phone3: z.string().length(4, { message: '4자리' }),
  year: z.string().length(4, { message: '4자리' }),
  month: z.string().min(1, { message: '1-2자리' }).max(2, { message: '1-2자리' }),
  day: z.string().min(1, { message: '1-2자리' }).max(2, { message: '1-2자리' }),
});

type InstructorFormValues = z.infer<typeof instructorFormSchema>;

function InstructorRegistrationDialog({ open, onOpenChange }: { open: boolean, onOpenChange: (open: boolean) => void }) {
  const firestore = useFirestore();
  const { toast } = useToast();
  
  const form = useForm<InstructorFormValues>({
    resolver: zodResolver(instructorFormSchema),
    defaultValues: {
      name: '',
      email: '',
      phone1: '',
      phone2: '',
      phone3: '',
      year: '',
      month: '',
      day: '',
    },
  });

  const onSubmit: SubmitHandler<InstructorFormValues> = async (data) => {
    if (!firestore) return;

    try {
        const fullPhone = `${data.phone1}-${data.phone2}-${data.phone3}`;
        const fullDob = `${data.year}-${data.month.padStart(2, '0')}-${data.day.padStart(2, '0')}`;

        await addDoc(collection(firestore, 'instructors'), {
            name: data.name,
            email: data.email,
            phone: fullPhone,
            dob: fullDob,
            createdAt: serverTimestamp(),
        });
        toast({
            title: '등록 성공',
            description: `${data.name} 강사님이 성공적으로 등록되었습니다.`,
        });
        form.reset();
        onOpenChange(false);
    } catch (error) {
      console.error('Error adding instructor:', error);
      toast({
        variant: 'destructive',
        title: '등록 실패',
        description: '강사 등록 중 오류가 발생했습니다.',
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>새 강사 등록</DialogTitle>
          <DialogDescription>아래 폼을 작성하여 새로운 강사를 시스템에 등록합니다.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
            <div className="grid md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>이름</FormLabel>
                    <FormControl><Input placeholder="홍길동" {...field} /></FormControl>
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
                    <FormControl><Input type="email" placeholder="instructor@example.com" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormItem>
                <FormLabel>연락처</FormLabel>
                <div className="flex items-center gap-2">
                  <FormField
                    control={form.control}
                    name="phone1"
                    render={({ field }) => (
                      <FormItem className="flex-1">
                        <FormControl><Input maxLength={3} {...field} /></FormControl>
                      </FormItem>
                    )}
                  />
                  <span>-</span>
                  <FormField
                    control={form.control}
                    name="phone2"
                    render={({ field }) => (
                      <FormItem className="flex-1">
                        <FormControl><Input maxLength={4} {...field} /></FormControl>
                      </FormItem>
                    )}
                  />
                  <span>-</span>
                  <FormField
                    control={form.control}
                    name="phone3"
                    render={({ field }) => (
                      <FormItem className="flex-1">
                        <FormControl><Input maxLength={4} {...field} /></FormControl>
                      </FormItem>
                    )}
                  />
                </div>
                <FormMessage>
                  {form.formState.errors.phone1?.message ||
                    form.formState.errors.phone2?.message ||
                    form.formState.errors.phone3?.message}
                </FormMessage>
              </FormItem>
              <FormItem>
                <FormLabel>생년월일</FormLabel>
                <div className="flex items-center gap-2">
                  <FormField
                    control={form.control}
                    name="year"
                    render={({ field }) => (
                      <FormItem className="flex-1">
                        <FormControl>
                          <Input placeholder="YYYY" maxLength={4} {...field} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <span>-</span>
                  <FormField
                    control={form.control}
                    name="month"
                    render={({ field }) => (
                      <FormItem className="w-20">
                        <FormControl>
                          <Input placeholder="MM" maxLength={2} {...field} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <span>-</span>
                  <FormField
                    control={form.control}
                    name="day"
                    render={({ field }) => (
                      <FormItem className="w-20">
                        <FormControl>
                          <Input placeholder="DD" maxLength={2} {...field} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>
                <FormMessage>
                  {form.formState.errors.year?.message ||
                    form.formState.errors.month?.message ||
                    form.formState.errors.day?.message}
                </FormMessage>
              </FormItem>
            </div>
             <DialogFooter className="pt-4">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
                <Button type="submit" disabled={form.formState.isSubmitting}>
                  {form.formState.isSubmitting ? '등록 중...' : '강사 등록'}
                </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export default function InstructorManager() {
  const firestore = useFirestore();
  const [isRegisterDialogOpen, setRegisterDialogOpen] = useState(false);
  
  const instructorsQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'instructors'), orderBy('createdAt', 'desc')) : null), [firestore]);
  const { data: instructors, isLoading } = useCollection<Instructor>(instructorsQuery);

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>등록된 강사 목록</CardTitle>
            <CardDescription>시스템에 등록된 전체 강사 목록입니다.</CardDescription>
          </div>
          <Button onClick={() => setRegisterDialogOpen(true)}>
            <PlusCircle className="mr-2 h-4 w-4" />
            강사 등록
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>이름</TableHead>
                <TableHead>이메일</TableHead>
                <TableHead>연락처</TableHead>
                <TableHead>생년월일</TableHead>
                <TableHead>등록일</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={5}><Skeleton className="h-8 w-full" /></TableCell>
                  </TableRow>
                ))
              ) : instructors?.length ? (
                instructors.map((instructor) => (
                  <TableRow key={instructor.id}>
                    <TableCell className="font-medium">{instructor.name}</TableCell>
                    <TableCell>{instructor.email}</TableCell>
                    <TableCell>{instructor.phone}</TableCell>
                    <TableCell>{instructor.dob}</TableCell>
                    <TableCell>{toDisplayDate(instructor.createdAt)}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="text-center h-24">
                    등록된 강사가 없습니다.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      
      <InstructorRegistrationDialog 
        open={isRegisterDialogOpen}
        onOpenChange={setRegisterDialogOpen}
      />
    </>
  );
}
