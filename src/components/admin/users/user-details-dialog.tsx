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
import { collection, query, where, doc, updateDoc, addDoc, serverTimestamp, writeBatch, Timestamp as FirebaseTimestamp } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { add } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { toDisplayDate } from '@/lib/date-helpers';

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

    const [name, setName] = useState(user.name);
    const [phone, setPhone] = useState(user.phone);
    const [dob, setDob] = useState(user.dob);
    const [bonusDays, setBonusDays] = useState('');
    const [bonusCourseId, setBonusCourseId] = useState('');
    
    useEffect(() => {
        setUser(initialUser);
        setName(initialUser.name);
        setPhone(initialUser.phone);
        setDob(initialUser.dob);
    }, [initialUser]);


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
        toast({ variant: 'destructive', title: '저장 실패', description: '사용자 정보 업데이트 중 오류 발생' });
      }
    };
    
    const handleBonusDaysChange = async (daysToAdd: number) => {
        if (!firestore || !bonusCourseId || !bonusDays) {
            toast({ variant: 'destructive', title: '입력 오류', description: '상세분류와 일수를 모두 입력해주세요.' });
            return;
        }

        const days = parseInt(bonusDays, 10);
        if (isNaN(days) || days <= 0) {
            toast({ variant: 'destructive', title: '입력 오류', description: '유효한 일수를 입력해주세요.' });
            return;
        }

        const currentSub = user.activeSubscriptions?.[bonusCourseId];
        const currentExpiry = currentSub?.expiresAt ? (currentSub.expiresAt as FirebaseTimestamp).toDate() : null;
        const currentPurchase = currentSub?.purchasedAt ? (currentSub.purchasedAt as FirebaseTimestamp).toDate() : null;

        if (daysToAdd < 0 && !currentExpiry) {
            toast({ variant: 'destructive', title: '오류', description: '구독 기간이 없는 사용자의 기간을 차감할 수 없습니다.' });
            return;
        }

        try {
            const batch = writeBatch(firestore);
            const userRef = doc(firestore, 'users', user.id);
            const now = new Date();
            
            const startDate = currentExpiry && currentExpiry > now ? currentExpiry : now;
            let newExpiryDate = add(startDate, { days: days * daysToAdd });
            
            // Ensure expiry doesn't go before purchase date when reducing
            if (daysToAdd < 0 && currentPurchase && newExpiryDate < currentPurchase) {
                 toast({ variant: 'destructive', title: '차감 오류', description: `만료일이 구독 시작일(${toDisplayDate(currentPurchase)})보다 빨라질 수 없습니다.` });
                 return;
            }

            const newExpiryTimestamp = FirebaseTimestamp.fromDate(newExpiryDate);

            const newActiveSub = {
                expiresAt: newExpiryTimestamp,
                purchasedAt: currentSub?.purchasedAt || serverTimestamp()
            };
            
            batch.update(userRef, {
                [`activeSubscriptions.${bonusCourseId}`]: newActiveSub
            });
            
            const bonusSubscriptionRef = doc(collection(firestore, 'users', user.id, 'subscriptions'));
            const transactionType = daysToAdd > 0 ? 'BONUS' : 'DEDUCTION';
            const transactionName = daysToAdd > 0 ? `보너스 ${days}일` : `기간 차감 ${days}일`;

            const bonusSubscriptionData: Omit<Subscription, 'id'> = {
                userId: user.id,
                courseId: bonusCourseId,
                purchasedAt: serverTimestamp() as Timestamp,
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


            toast({ title: '성공', description: `${days}일의 기간이 성공적으로 ${daysToAdd > 0 ? '추가' : '차감'}되었습니다.` });
            setBonusDays('');
            // Keep bonusCourseId selected for potential further actions
        } catch (error) {
             console.error("Failed to add bonus days:", error);
             toast({ variant: 'destructive', title: '오류', description: '보너스 기간 변경에 실패했습니다.' });
        }
    };

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
            <Table>
                <TableHeader><TableRow><TableHead>상세분류</TableHead><TableHead>만료일</TableHead></TableRow></TableHeader>
                <TableBody>
                    {user.activeSubscriptions && Object.entries(user.activeSubscriptions).map(([id, sub]) => (
                        <TableRow key={id}>
                            <TableCell>{getCourseName(id)}</TableCell>
                            <TableCell>{toDisplayDate(sub.expiresAt)}</TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
            <h4 className="font-semibold mt-6 mb-2">보너스 이용 기간 관리</h4>
            <div className="flex gap-2 items-center">
                <Select value={bonusCourseId} onValueChange={setBonusCourseId}>
                    <SelectTrigger className="w-[180px]"><SelectValue placeholder="상세분류 선택" /></SelectTrigger>
                    <SelectContent>{courses?.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
                <Input type="number" placeholder="일수(토큰)" className="w-24" value={bonusDays} onChange={e => setBonusDays(e.target.value)} />
                <Button onClick={() => handleBonusDaysChange(1)}>추가</Button>
                <Button variant="destructive" onClick={() => handleBonusDaysChange(-1)}>차감</Button>
            </div>
          </TabsContent>
          <TabsContent value="history" className="mt-4">
          <Table>
                <TableHeader><TableRow><TableHead>날짜</TableHead><TableHead>종류</TableHead><TableHead>내역</TableHead><TableHead>금액</TableHead></TableRow></TableHeader>
                <TableBody>
                    {subscriptions?.map((sub) => (
                        <TableRow key={sub.id}>
                            <TableCell>{toDisplayDate(sub.purchasedAt)}</TableCell>
                            <TableCell><Badge variant={sub.status === 'PAID' ? 'default' : 'secondary'}>{sub.status}</Badge></TableCell>
                            <TableCell>{sub.orderName}</TableCell>
                            <TableCell>{sub.amount.toLocaleString('ko-KR')}원</TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
