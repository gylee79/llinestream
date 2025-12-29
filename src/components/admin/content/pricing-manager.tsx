
'use client';

import { useState, useEffect } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import type { Classification } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useCollection, useFirestore, useMemoFirebase } from '@/firebase/hooks';
import { collection, doc, updateDoc } from 'firebase/firestore';
import { Skeleton } from '@/components/ui/skeleton';

export default function PricingManager() {
  const firestore = useFirestore();
  const { toast } = useToast();
  
  const classificationsQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'classifications') : null), [firestore]);
  const { data: classifications, isLoading } = useCollection<Classification>(classificationsQuery);

  // We need a local state to handle input changes before saving to Firestore
  const [localClassifications, setLocalClassifications] = useState<Classification[] | null>(null);

  useEffect(() => {
    if (classifications) {
      setLocalClassifications(classifications);
    }
  }, [classifications]);


  const handlePriceChange = (classId: string, duration: keyof Classification['prices'], value: string) => {
    const price = Number(value);
    if (isNaN(price) || !localClassifications) return;
    
    setLocalClassifications(prev => 
      prev!.map(c => 
        c.id === classId 
          ? { ...c, prices: { ...c.prices, [duration]: price } }
          : c
      )
    );
  };
  
  const handleSave = async (classId: string) => {
    if (!firestore || !localClassifications) return;
    const classification = localClassifications.find(c => c.id === classId);
    if (!classification) return;

    const docRef = doc(firestore, 'classifications', classId);
    // We only update the prices field
    await updateDoc(docRef, { prices: classification.prices });

    toast({
      title: '저장 완료',
      description: `${classification.name}의 가격 정보가 업데이트되었습니다.`,
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>분류 및 가격 관리</CardTitle>
        <p className="text-sm text-muted-foreground">각 &apos;큰분류&apos;별 이용권 가격을 설정합니다.</p>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>큰분류 이름</TableHead>
              <TableHead>1일 이용권 (원)</TableHead>
              <TableHead>30일 이용권 (원)</TableHead>
              <TableHead>60일 이용권 (원)</TableHead>
              <TableHead>90일 이용권 (원)</TableHead>
              <TableHead className="text-right">저장</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading || !localClassifications ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center">
                  <Skeleton className="h-8 w-full" />
                </TableCell>
              </TableRow>
            ) : (
              localClassifications.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">{item.name}</TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      value={item.prices?.day1 ?? 0}
                      onChange={(e) => handlePriceChange(item.id, 'day1', e.target.value)}
                      className="w-24"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      value={item.prices?.day30 ?? 0}
                      onChange={(e) => handlePriceChange(item.id, 'day30', e.target.value)}
                      className="w-24"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      value={item.prices?.day60 ?? 0}
                      onChange={(e) => handlePriceChange(item.id, 'day60', e.target.value)}
                      className="w-24"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      value={item.prices?.day90 ?? 0}
                      onChange={(e) => handlePriceChange(item.id, 'day90', e.target.value)}
                      className="w-24"
                    />
                  </TableCell>
                  <TableCell className="text-right">
                      <Button onClick={() => handleSave(item.id)}>저장</Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
