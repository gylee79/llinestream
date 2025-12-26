
'use client';

import { useForm, type SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
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

const instructorSchema = z.object({
  name: z.string().min(2, { message: '이름은 2자 이상이어야 합니다.' }),
  phone: z.string().regex(/^\d{3}-\d{3,4}-\d{4}$/, { message: '연락처 형식을 확인해주세요. (010-XXXX-XXXX)' }),
  email: z.string().email({ message: '유효한 이메일을 입력해주세요.' }),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: '생년월일 형식을 확인해주세요. (YYYY-MM-DD)' }),
});

type InstructorFormValues = z.infer<typeof instructorSchema>;

export default function InstructorManager() {
  const firestore = useFirestore();
  const { toast } = useToast();
  
  const instructorsQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'instructors'), orderBy('createdAt', 'desc')) : null), [firestore]);
  const { data: instructors, isLoading } = useCollection<Instructor>(instructorsQuery);

  const form = useForm<InstructorFormValues>({
    resolver: zodResolver(instructorSchema),
    defaultValues: {
      name: '',
      phone: '',
      email: '',
      dob: '',
    },
  });

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
  
  const onSubmit: SubmitHandler<InstructorFormValues> = async (data) => {
    if (!firestore) return;

    try {
      await addDoc(collection(firestore, 'instructors'), {
        ...data,
        createdAt: serverTimestamp(),
      });
      toast({
        title: '등록 성공',
        description: `${data.name} 강사님이 성공적으로 등록되었습니다.`,
      });
      form.reset();
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
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>새 강사 등록</CardTitle>
          <CardDescription>아래 폼을 작성하여 새로운 강사를 시스템에 등록합니다.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
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
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>이메일</FormLabel>
                      <FormControl><Input type="email" placeholder="instructor@example.com" {...field} /></FormControl>
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
              </div>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? '등록 중...' : '강사 등록'}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>등록된 강사 목록</CardTitle>
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
    </div>
  );
}

    