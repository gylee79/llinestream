
'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
  } from '@/components/ui/select';
import type { User, Course, Subscription, Timestamp } from '@/lib/types';
import { useCollection, useFirestore, useMemoFirebase } from '@/firebase/hooks';
import { collection, query, where, doc, updateDoc, writeBatch, Timestamp as FirebaseTimestamp } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { add, isBefore, isAfter } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { toDisplayDate, toJSDate } from '@/lib/date-helpers';
import { Minus, Plus } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';

interface UserDetailsDialogProps {
  user: User;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courses: Course[];
}

export function UserDetailsDialog({ user: initialUser, open, onOpenChange, courses }: UserDetailsDialogProps) {
    const firestore = useFirestore();
    const { toast } = useToast();
    
    const [user, setUser] = useState(initialUser);
    const [name, setName] = useState(initialUser.name);
    const [phone, setPhone] = useState(initialUser.phone);
    const [dob, setDob] = useState(initialUser.dob);
    
    const [bonusDays, setBonusDays] = useState<number>(0);
    const [bonusCourseId, setBonusCourseId] = useState('');

    useEffect(() => {
        setUser(initialUser);
        setName(initialUser.name);
        setPhone(initialUser.phone);
        setDob(initialUser.dob);
        setBonusDays(0);
        setBonusCourseId('');
    }, [initialUser, open]);


    const subscriptionsQuery = useMemoFirebase(() => (
      firestore ? query(collection(firestore, 'users', user.id, 'subscriptions'), where('userId', '==', user.id)) : null
    ), [firestore, user.id]);
    const { data: subscriptions } = useCollection<Subscription>(subscriptionsQuery);

    const getCourseName = (id: string) => courses?.find(c => c.id === id)?.name || '알 수 없음';
    
    const handleSaveUserInfo = async () => {
      if (!firestore) return;
      const userRef = doc(firestore, 'users', user.id);
      try {
        await updateDoc(userRef, { name, phone, dob });
        toast({ title: '저장 완료', description: '사용자 정보가 업데이트되었습니다.' });
      } catch (error) {
        console.error(error);
        toast({ variant: 'destructive', title: '저장 실패', description: '사용자 정보 업데이트 중 오류가 발생' });
      }
    };
    
    const handleApplyBonusDays = async () => {
        if (!firestore || !bonusCourseId || bonusDays === 0) {
            toast({ variant: 'destructive', title: '입력 오류', description: '상세분류를 선택하고 변경할 일수(토큰)를 입력해주세요.' });
            return;
        }

        const currentSub = user.activeSubscriptions?.[bonusCourseId];
        const currentExpiry = currentSub?.expiresAt ? toJSDate(currentSub.expiresAt) : null;
        const currentPurchase = currentSub?.purchasedAt ? toJSDate(currentSub.purchasedAt) : null;

        if (bonusDays < 0 && !currentExpiry) {
            toast({ variant: 'destructive', title: '오류', description: '구독 기간이 없는 사용자의 기간을 차감할 수 없습니다.' });
            return;
        }

        try {
            const batch = writeBatch(firestore);
            const userRef = doc(firestore, 'users', user.id);
            const now = new Date();
            let newExpiryDate: Date;
            let wasExpiryAdjusted = false;
            
            const startDate = currentExpiry && isBefore(now, currentExpiry) ? currentExpiry : now;
            newExpiryDate = add(startDate, { days: bonusDays });

            if (isBefore(newExpiryDate, now)) {
              newExpiryDate = now;
              wasExpiryAdjusted = true;
            }

            if (currentPurchase && isBefore(newExpiryDate, currentPurchase)) {
                toast({ variant: 'destructive', title: '차감 오류', description: `만료일이 구독 시작일(${toDisplayDate(currentPurchase) || '알수없음'})보다 빨라질 수 없습니다.` });
                return;
            }
            
            const newExpiryTimestamp = FirebaseTimestamp.fromDate(newExpiryDate);
            const newActiveSub = {
                expiresAt: newExpiryTimestamp,
                purchasedAt: currentSub?.purchasedAt || FirebaseTimestamp.now()
            };
            
            batch.update(userRef, {
                [`activeSubscriptions.${bonusCourseId}`]: newActiveSub
            });
            
            const bonusSubscriptionRef = doc(collection(firestore, 'users', user.id, 'subscriptions'));
            const transactionType = bonusDays > 0 ? 'BONUS' : 'DEDUCTION';
            const transactionName = `${bonusDays > 0 ? '보너스' : '기간 차감'} ${Math.abs(bonusDays)}일`;

            const bonusSubscriptionData: Omit<Subscription, 'id'> = {
                userId: user.id,
                courseId: bonusCourseId,
                purchasedAt: FirebaseTimestamp.now() as Timestamp,
                expiresAt: newExpiryTimestamp as Timestamp,
                amount: 0,
                orderName: transactionName,
                paymentId: `${transactionType.toLowerCase()}-${bonusSubscriptionRef.id}`,
                status: transactionType,
                method: 'INTERNAL'
            };
            batch.set(bonusSubscriptionRef, bonusSubscriptionData);
            
            await batch.commit();

            setUser(currentUser => ({
                ...currentUser,
                activeSubscriptions: {
                    ...currentUser.activeSubscriptions,
                    [bonusCourseId]: {
                        ...currentUser.activeSubscriptions?.[bonusCourseId],
                        expiresAt: newExpiryTimestamp,
                    }
                }
            }));

            if (wasExpiryAdjusted) {
                toast({
                    title: '만료일 조정 및 적용 완료',
                    description: '오늘보다 과거를 만료일로 설정 할 수 없어 만료일을 오늘로 설정했습니다.',
                });
            } else {
                 toast({ title: '성공', description: `${Math.abs(bonusDays)}일의 기간이 성공적으로 ${bonusDays > 0 ? '추가' : '차감'}되었습니다.` });
            }
            setBonusDays(0);
        } catch (error) {
             console.error("Failed to apply bonus days:", error);
             toast({ variant: 'destructive', title: '오류', description: '보너스 기간 적용에 실패했습니다.' });
        }
    };

    const handleBonusDaysInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setBonusDays(value === '' ? 0 : parseInt(value, 10));
    };

    const adjustBonusDays = (amount: number) => {
        setBonusDays(prev => prev + amount);
    };

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
        return sub.method === 'CARD' ? '카드 결제' : sub.method;
      }
      return 'N/A';
    }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-headline">{user.name || user.email}</DialogTitle>
          <DialogDescription>
            사용자의 정보를 수정하고 구독 내역을 관리합니다. 이메일: {user.email}
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="info" className="mt-4">
          <TabsList>
            <TabsTrigger value="info">기본 정보</TabsTrigger>
            <TabsTrigger value="subscriptions">이용권 관리</TabsTrigger>
            <TabsTrigger value="history">거래 이력</TabsTrigger>
          </TabsList>
          <TabsContent value="info" className="mt-4">
            <div className="space-y-4">
                <div>
                    <Label htmlFor="name">이름</Label>
                    <Input id="name" value={name || ''} onChange={e => setName(e.target.value)} />
                </div>
                <div>
                    <Label htmlFor="phone">연락처</Label>
                    <Input id="phone" value={phone || ''} onChange={e => setPhone(e.target.value)} />
                </div>
                <div>
                    <Label htmlFor="dob">생년월일</Label>
                    <Input id="dob" value={dob || ''} onChange={e => setDob(e.target.value)} />
                </div>
            </div>
             <DialogFooter className="mt-4">
                <Button onClick={handleSaveUserInfo}>저장</Button>
            </DialogFooter>
          </TabsContent>
          <TabsContent value="subscriptions" className="mt-4">
            <h4 className="font-semibold mb-2">활성 이용권 현황</h4>
            <ScrollArea className="h-40 w-full rounded-md border">
              <Table>
                  <TableHeader><TableRow><TableHead className="p-2 text-xs">상세분류</TableHead><TableHead className="p-2 text-xs">만료일</TableHead></TableRow></TableHeader>
                  <TableBody>
                      {user.activeSubscriptions && Object.entries(user.activeSubscriptions).map(([courseId, sub]) => (
                          <TableRow key={courseId}>
                              <TableCell className="p-2 text-sm">{getCourseName(courseId)}</TableCell>
                              <TableCell className="p-2 text-sm">{toDisplayDate(sub.expiresAt)}</TableCell>
                          </TableRow>
                      ))}
                  </TableBody>
              </Table>
            </ScrollArea>
            <h4 className="font-semibold mt-6 mb-2">보너스 이용 기간 관리</h4>
            <div className="flex gap-2 items-center">
                <Select value={bonusCourseId} onValueChange={setBonusCourseId}>
                    <SelectTrigger className="w-[180px]"><SelectValue placeholder="상세분류 선택" /></SelectTrigger>
                    <SelectContent>{courses?.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
                <div className="flex items-center">
                  <Button variant="outline" size="icon" className="h-10 w-10" onClick={() => adjustBonusDays(-1)}><Minus className="h-4 w-4" /></Button>
                  <Input 
                    type="number" 
                    placeholder="일수(토큰)" 
                    className="w-24 text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" 
                    value={bonusDays} 
                    onChange={handleBonusDaysInputChange} 
                  />
                  <Button variant="outline" size="icon" className="h-10 w-10" onClick={() => adjustBonusDays(1)}><Plus className="h-4 w-4" /></Button>
                </div>
                <Button onClick={handleApplyBonusDays}>기간 적용</Button>
            </div>
          </TabsContent>
          <TabsContent value="history" className="mt-4">
            <ScrollArea className="h-60 w-full rounded-md border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="p-2 text-xs">날짜</TableHead>
                            <TableHead className="p-2 text-xs">카테고리</TableHead>
                            <TableHead className="p-2 text-xs">결제 수단</TableHead>
                            <TableHead className="p-2 text-xs">내역</TableHead>
                            <TableHead className="p-2 text-xs text-right">금액</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {subscriptions?.map((sub) => (
                            <TableRow key={sub.id}>
                                <TableCell className="p-2 text-sm">{toDisplayDate(sub.purchasedAt)}</TableCell>
                                <TableCell className="p-2 text-sm">{getCourseName(sub.courseId)}</TableCell>
                                <TableCell className="p-2 text-sm">{getPaymentMethod(sub)}</TableCell>
                                <TableCell className="p-2 text-sm">{sub.orderName}</TableCell>
                                <TableCell className="p-2 text-sm text-right">{sub.amount.toLocaleString('ko-KR')}원</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
