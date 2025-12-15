'use client';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { Subscription, User, Classification } from '@/lib/types';
import { useCollection, useFirestore, useMemoFirebase } from '@/firebase';
import { collection, collectionGroup, query, orderBy } from 'firebase/firestore';
import { Skeleton } from '@/components/ui/skeleton';

export default function AdminSubscriptionsPage() {
  const firestore = useFirestore();

  // 모든 사용자의 'subscriptions' 서브 컬렉션을 한 번에 가져옴
  const subscriptionsQuery = useMemoFirebase(
    () => (firestore ? query(collectionGroup(firestore, 'subscriptions'), orderBy('purchasedAt', 'desc')) : null),
    [firestore]
  );
  const { data: subscriptions, isLoading: subsLoading } = useCollection<Subscription>(subscriptionsQuery);
  
  // 사용자 및 분류 정보를 매핑하기 위해 가져옴
  const usersQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'users') : null), [firestore]);
  const { data: users, isLoading: usersLoading } = useCollection<User>(usersQuery);

  const classificationsQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'classifications') : null), [firestore]);
  const { data: classifications, isLoading: classLoading } = useCollection<Classification>(classificationsQuery);

  const isLoading = subsLoading || usersLoading || classLoading;

  const getUserName = (userId: string) => users?.find(u => u.id === userId)?.name || '알 수 없음';
  const getClassificationName = (classId: string) => classifications?.find(c => c.id === classId)?.name || '알 수 없음';

  const getSubscriptionStatus = (expiresAt: Date) => {
    const isExpired = new Date() > expiresAt;
    return (
      <Badge variant={isExpired ? 'destructive' : 'default'}>
        {isExpired ? '만료됨' : '활성'}
      </Badge>
    );
  };

  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tight font-headline">구독/결제 관리</h1>
      <p className="text-muted-foreground">전체 사용자 구독 및 결제 내역을 최신순으로 관리합니다.</p>
      
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>전체 구독 내역</CardTitle>
          <CardDescription>
            사용자가 결제를 완료하면 해당 내역이 여기에 실시간으로 표시됩니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>사용자</TableHead>
                <TableHead>이용권(분류)</TableHead>
                <TableHead>결제일</TableHead>
                <TableHead>만료일</TableHead>
                <TableHead>상태</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={5}><Skeleton className="h-8 w-full" /></TableCell>
                  </TableRow>
                ))
              ) : subscriptions && subscriptions.length > 0 ? (
                subscriptions.map((sub) => (
                  <TableRow key={sub.id + sub.userId}>
                    <TableCell className="font-medium">{getUserName(sub.userId)}</TableCell>
                    <TableCell>{getClassificationName(sub.classificationId)}</TableCell>
                    <TableCell>{sub.purchasedAt?.toDate().toLocaleDateString('ko-KR')}</TableCell>
                    <TableCell>{sub.expiresAt?.toDate().toLocaleDateString('ko-KR')}</TableCell>
                    <TableCell>{sub.expiresAt && getSubscriptionStatus(sub.expiresAt.toDate())}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="text-center h-24">
                    구독 내역이 없습니다.
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
