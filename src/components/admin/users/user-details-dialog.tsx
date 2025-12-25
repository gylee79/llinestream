
'use client';

import { useState } from 'react';
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
import type { User, Classification, Subscription } from '@/lib/types';
import { useCollection, useFirestore, useMemoFirebase } from '@/firebase/hooks';
import { collection, query, where, doc, updateDoc, addDoc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { add } from 'date-fns';

interface UserDetailsDialogProps {
  user: User;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function UserDetailsDialog({ user, open, onOpenChange }: UserDetailsDialogProps) {
    const firestore = useFirestore();
    const { toast } = useToast();
    const [name, setName] = useState(user.name);
    const [phone, setPhone] = useState(user.phone);
    const [dob, setDob] = useState(user.dob);
    const [bonusDays, setBonusDays] = useState('');
    const [bonusClassification, setBonusClassification] = useState('');
    
    const classificationsQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'classifications') : null), [firestore]);
    const { data: classifications } = useCollection<Classification>(classificationsQuery);

    const subscriptionsQuery = useMemoFirebase(() => (
      firestore ? query(collection(firestore, 'users', user.id, 'subscriptions'), where('userId', '==', user.id)) : null
    ), [firestore, user.id]);
    const { data: subscriptions } = useCollection<Subscription>(subscriptionsQuery);

    const getClassificationName = (id: string) => classifications?.find(c => c.id === id)?.name || '알 수 없음';
    
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
    
    const handleAddBonusDays = async () => {
        if (!firestore || !bonusClassification || !bonusDays) {
            toast({ variant: 'destructive', title: '입력 오류', description: '분류와 일수를 모두 입력해주세요.' });
            return;
        }

        const days = parseInt(bonusDays, 10);
        if (isNaN(days) || days <= 0) {
            toast({ variant: 'destructive', title: '입력 오류', description: '유효한 일수를 입력해주세요.' });
            return;
        }

        try {
            const batch = writeBatch(firestore);
            const userRef = doc(firestore, 'users', user.id);
            const now = new Date();
            
            const currentSub = user.activeSubscriptions?.[bonusClassification];
            const currentExpiry = currentSub?.expiresAt.toDate();
            
            const startDate = currentExpiry && currentExpiry > now ? currentExpiry : now;
            const newExpiryDate = add(startDate, { days });

            const newActiveSub = {
                expiresAt: newExpiryDate,
                purchasedAt: currentSub?.purchasedAt || serverTimestamp()
            };
            
            batch.update(userRef, {
                [`activeSubscriptions.${bonusClassification}`]: newActiveSub
            });
            
            // Add a record in the subscriptions subcollection for history
            const bonusSubscriptionRef = doc(collection(firestore, 'users', user.id, 'subscriptions'));
            const bonusSubscriptionData: Omit<Subscription, 'id'> = {
                userId: user.id,
                classificationId: bonusClassification,
                purchasedAt: serverTimestamp(),
                expiresAt: newExpiryDate,
                amount: 0,
                orderName: `보너스 ${days}일`,
                paymentId: `bonus-${bonusSubscriptionRef.id}`,
                status: 'BONUS',
                method: 'INTERNAL'
            };
            batch.set(bonusSubscriptionRef, bonusSubscriptionData);
            
            await batch.commit();

            toast({ title: '성공', description: `${days}일의 보너스 기간이 추가되었습니다.` });
            setBonusDays('');
            setBonusClassification('');

        } catch (error) {
             console.error("Failed to add bonus days:", error);
             toast({ variant: 'destructive', title: '오류', description: '보너스 기간 추가에 실패했습니다.' });
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
                <TableHeader><TableRow><TableHead>분류</TableHead><TableHead>만료일</TableHead></TableRow></TableHeader>
                <TableBody>
                    {user.activeSubscriptions && Object.entries(user.activeSubscriptions).map(([id, sub]) => (
                        <TableRow key={id}>
                            <TableCell>{getClassificationName(id)}</TableCell>
                            <TableCell>{sub.expiresAt.toDate().toLocaleDateString('ko-KR')}</TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
            <h4 className="font-semibold mt-6 mb-2">보너스 이용 기간 추가</h4>
            <div className="flex gap-2 items-center">
                <Select value={bonusClassification} onValueChange={setBonusClassification}>
                    <SelectTrigger className="w-[180px]"><SelectValue placeholder="분류 선택" /></SelectTrigger>
                    <SelectContent>{classifications?.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
                <Input type="number" placeholder="일수" className="w-24" value={bonusDays} onChange={e => setBonusDays(e.target.value)} />
                <Button onClick={handleAddBonusDays}>추가</Button>
            </div>
          </TabsContent>
          <TabsContent value="history" className="mt-4">
          <Table>
                <TableHeader><TableRow><TableHead>날짜</TableHead><TableHead>종류</TableHead><TableHead>내역</TableHead><TableHead>금액</TableHead></TableRow></TableHeader>
                <TableBody>
                    {subscriptions?.map((sub) => (
                        <TableRow key={sub.id}>
                            <TableCell>{sub.purchasedAt.toDate().toLocaleDateString('ko-KR')}</TableCell>
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

    
