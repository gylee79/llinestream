
'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCollection, useFirestore, useMemoFirebase } from '@/firebase/hooks';
import type { User, Subscription, Course } from '@/lib/types';
import { collection, query, where, orderBy } from 'firebase/firestore';
import { toDisplayDate } from '@/lib/date-helpers';
import { Badge } from '../ui/badge';
import { ScrollArea } from '../ui/scroll-area';
import { formatPrice } from '@/lib/utils';
import { Skeleton } from '../ui/skeleton';

interface BillingDialogProps {
  user: User;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function BillingDialog({ user, open, onOpenChange }: BillingDialogProps) {
  const firestore = useFirestore();

  const coursesQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'courses') : null), [firestore]);
  const { data: courses, isLoading: coursesLoading } = useCollection<Course>(coursesQuery);

  const subscriptionsQuery = useMemoFirebase(() =>
    firestore ? query(
        collection(firestore, 'users', user.id, 'subscriptions'), 
        orderBy('purchasedAt', 'desc')
    ) : null,
    [firestore, user.id]
  );
  const { data: subscriptions, isLoading: subsLoading } = useCollection<Subscription>(subscriptionsQuery);

  const getCourseName = (courseId: string) => courses?.find((c) => c.id === courseId)?.name || '알 수 없음';
  
  const isLoading = coursesLoading || subsLoading;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>결제 정보</DialogTitle>
          <DialogDescription>
            나의 이용권 현황과 결제 이력을 확인합니다.
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="status" className="mt-4">
          <TabsList>
            <TabsTrigger value="status">이용권 현황</TabsTrigger>
            <TabsTrigger value="history">결제 이력</TabsTrigger>
          </TabsList>
          <TabsContent value="status" className="mt-4">
            <h4 className="font-semibold mb-2">활성 이용권 목록</h4>
            <ScrollArea className="h-60 w-full rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="p-2 text-xs">상세분류</TableHead>
                    <TableHead className="p-2 text-xs">만료일</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow><TableCell colSpan={2}><Skeleton className="h-8 w-full"/></TableCell></TableRow>
                  ) : user.activeSubscriptions && Object.keys(user.activeSubscriptions).length > 0 ? (
                    Object.entries(user.activeSubscriptions).map(([courseId, sub]) => (
                      <TableRow key={courseId}>
                        <TableCell className="p-2 text-sm">{getCourseName(courseId)}</TableCell>
                        <TableCell className="p-2 text-sm">{toDisplayDate(sub.expiresAt)}</TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={2} className="h-24 text-center">활성화된 이용권이 없습니다.</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </ScrollArea>
          </TabsContent>
          <TabsContent value="history" className="mt-4">
            <h4 className="font-semibold mb-2">전체 결제 내역</h4>
             <ScrollArea className="h-60 w-full rounded-md border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="p-2 text-xs">결제일</TableHead>
                            <TableHead className="p-2 text-xs">상태</TableHead>
                            <TableHead className="p-2 text-xs">내역</TableHead>
                            <TableHead className="p-2 text-xs text-right">금액</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {isLoading ? (
                           <TableRow><TableCell colSpan={4}><Skeleton className="h-8 w-full"/></TableCell></TableRow>
                        ) : subscriptions && subscriptions.length > 0 ? (
                            subscriptions.map((sub) => (
                                <TableRow key={sub.id}>
                                    <TableCell className="p-2 text-sm">{toDisplayDate(sub.purchasedAt)}</TableCell>
                                    <TableCell className="p-2 text-sm">
                                        <Badge variant={sub.status === 'PAID' ? 'default' : 'secondary'} className="text-xs">
                                            {sub.status}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="p-2 text-sm">{sub.orderName}</TableCell>
                                    <TableCell className="p-2 text-sm text-right">{formatPrice(sub.amount)}</TableCell>
                                </TableRow>
                            ))
                        ) : (
                             <TableRow>
                                <TableCell colSpan={4} className="h-24 text-center">결제 내역이 없습니다.</TableCell>
                             </TableRow>
                        )}
                    </TableBody>
                </Table>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

