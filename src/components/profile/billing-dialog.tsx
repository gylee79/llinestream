
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
import type { User, Subscription, Classification, Course } from '@/lib/types';
import { collection, query, where, orderBy } from 'firebase/firestore';
import { toDisplayDate, toJSDate } from '@/lib/date-helpers';
import { Badge } from '../ui/badge';
import { ScrollArea } from '../ui/scroll-area';
import { formatPrice } from '@/lib/utils';
import { Skeleton } from '../ui/skeleton';
import { isAfter } from 'date-fns';

interface BillingDialogProps {
  user: User;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function BillingDialog({ user, open, onOpenChange }: BillingDialogProps) {
  const firestore = useFirestore();
  
  const classificationsQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'classifications') : null), [firestore]);
  const { data: classifications, isLoading: classificationsLoading } = useCollection<Classification>(classificationsQuery);

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
  
  const getClassificationName = (classificationId: string) => classifications?.find((c) => c.id === classificationId)?.name || '알 수 없음';
  
  const isLoading = coursesLoading || subsLoading || classificationsLoading;

  const getSubscriptionStatusBadge = (sub: Subscription) => {
    const expires = toJSDate(sub.expiresAt);
    if (!expires) return <Badge variant="secondary">처리중</Badge>;
    const isExpired = isAfter(new Date(), expires);
    if (sub.status !== 'PAID') {
        return <Badge variant="secondary" className="text-xs">{sub.status}</Badge>
    }
    return (
      <Badge variant={isExpired ? 'outline' : 'default'} className="text-xs">
        {isExpired ? '만료됨' : '구독중'}
      </Badge>
    );
  };
  
  const getPaymentMethod = (sub: Subscription) => {
    if (sub.status === 'BONUS' || sub.status === 'DEDUCTION') {
      return '서비스 지급';
    }
    if (sub.amount > 0) {
      // In a real scenario, you might have more details in sub.method
      return sub.method === 'CARD' ? '카드 결제' : sub.method;
    }
    return 'N/A';
  }

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
                    <TableHead className="p-2 text-xs">카테고리</TableHead>
                    <TableHead className="p-2 text-xs">만료일</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow><TableCell colSpan={2}><Skeleton className="h-8 w-full"/></TableCell></TableRow>
                  ) : user.activeSubscriptions && Object.keys(user.activeSubscriptions).length > 0 ? (
                    Object.entries(user.activeSubscriptions).map(([classificationId, sub]) => (
                      <TableRow key={classificationId}>
                        <TableCell className="p-2 text-sm">{getClassificationName(classificationId)}</TableCell>
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
                            <TableHead className="p-2 text-xs">카테고리</TableHead>
                            <TableHead className="p-2 text-xs">결제 수단</TableHead>
                            <TableHead className="p-2 text-xs">내역</TableHead>
                            <TableHead className="p-2 text-xs text-right">금액</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {isLoading ? (
                           <TableRow><TableCell colSpan={5}><Skeleton className="h-8 w-full"/></TableCell></TableRow>
                        ) : subscriptions && subscriptions.length > 0 ? (
                            subscriptions.map((sub) => (
                                <TableRow key={sub.id}>
                                    <TableCell className="p-2 text-sm">{toDisplayDate(sub.purchasedAt)}</TableCell>
                                    <TableCell className="p-2 text-sm">{getClassificationName(sub.classificationId)}</TableCell>
                                    <TableCell className="p-2 text-sm">{getPaymentMethod(sub)}</TableCell>
                                    <TableCell className="p-2 text-sm">{sub.orderName}</TableCell>
                                    <TableCell className="p-2 text-sm text-right">{formatPrice(sub.amount)}</TableCell>
                                </TableRow>
                            ))
                        ) : (
                             <TableRow>
                                <TableCell colSpan={5} className="h-24 text-center">결제 내역이 없습니다.</TableCell>
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
