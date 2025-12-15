
'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
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
import type { User, Classification } from '@/lib/types';
import { useCollection, useFirestore, useMemoFirebase } from '@/firebase';
import { collection } from 'firebase/firestore';

interface UserDetailsDialogProps {
  user: User;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function UserDetailsDialog({ user, open, onOpenChange }: UserDetailsDialogProps) {
    const firestore = useFirestore();
    const classificationsQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'classifications') : null), [firestore]);
    const { data: classifications } = useCollection<Classification>(classificationsQuery);

    const activeSubs = user.activeSubscriptions ? Object.entries(user.activeSubscriptions).map(([id, sub]) => ({
        classification: classifications?.find(c => c.id === id)?.name || '알 수 없음',
        expiresAt: sub.expiresAt.toDate().toLocaleDateString(),
    })) : [];

    const transactionHistory = [
        { date: '2024-05-01', type: '결제', item: '코딩 30일 이용권', amount: '₩9,900' },
        { date: '2024-05-15', type: '보너스', item: '코딩 7일 추가', amount: '-' },
    ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-headline">{user.name || user.email}</DialogTitle>
          <DialogDescription>{user.email}</DialogDescription>
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
                    <Input id="name" defaultValue={user.name} />
                </div>
                <div>
                    <Label htmlFor="phone">연락처</Label>
                    <Input id="phone" defaultValue={user.phone} />
                </div>
                <div>
                    <Label htmlFor="dob">생년월일</Label>
                    <Input id="dob" defaultValue={user.dob} />
                </div>
                <Button>저장</Button>
            </div>
          </TabsContent>
          <TabsContent value="subscriptions" className="mt-4">
            <h4 className="font-semibold mb-2">활성 이용권 현황</h4>
            <Table>
                <TableHeader><TableRow><TableHead>분류</TableHead><TableHead>만료일</TableHead></TableRow></TableHeader>
                <TableBody>
                    {activeSubs.map(sub => <TableRow key={sub.classification}><TableCell>{sub.classification}</TableCell><TableCell>{sub.expiresAt}</TableCell></TableRow>)}
                </TableBody>
            </Table>
            <h4 className="font-semibold mt-6 mb-2">보너스 이용 기간 추가</h4>
            <div className="flex gap-2 items-center">
                <Select>
                    <SelectTrigger className="w-[180px]"><SelectValue placeholder="분류 선택" /></SelectTrigger>
                    <SelectContent>{classifications?.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
                <Input type="number" placeholder="일수" className="w-24" />
                <Button>추가</Button>
            </div>
          </TabsContent>
          <TabsContent value="history" className="mt-4">
          <Table>
                <TableHeader><TableRow><TableHead>날짜</TableHead><TableHead>종류</TableHead><TableHead>내역</TableHead><TableHead>금액</TableHead></TableRow></TableHeader>
                <TableBody>
                    {transactionHistory.map((item, i) => (
                        <TableRow key={i}>
                            <TableCell>{item.date}</TableCell>
                            <TableCell>{item.type}</TableCell>
                            <TableCell>{item.item}</TableCell>
                            <TableCell>{item.amount}</TableCell>
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
