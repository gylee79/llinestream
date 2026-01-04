
'use client';

import { useState, useEffect, useMemo } from 'react';
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
import type { Course, Classification, Field } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useCollection, useFirestore, useMemoFirebase } from '@/firebase/hooks';
import { collection, doc, updateDoc } from 'firebase/firestore';
import { Skeleton } from '@/components/ui/skeleton';
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@/components/ui/accordion"

export default function PricingManager() {
  const firestore = useFirestore();
  const { toast } = useToast();
  
  const fieldsQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'fields') : null), [firestore]);
  const { data: fields, isLoading: fieldsLoading } = useCollection<Field>(fieldsQuery);

  const classificationsQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'classifications') : null), [firestore]);
  const { data: classifications, isLoading: classLoading } = useCollection<Classification>(classificationsQuery);

  const coursesQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'courses') : null), [firestore]);
  const { data: courses, isLoading: coursesLoading } = useCollection<Course>(coursesQuery);

  const [localCourses, setLocalCourses] = useState<Course[] | null>(null);

  useEffect(() => {
    if (courses) {
      setLocalCourses(courses.map(c => ({
        ...c,
        prices: c.prices || { day1: 0, day30: 0, day60: 0, day90: 0 }
      })));
    }
  }, [courses]);

  const handlePriceChange = (courseId: string, duration: keyof Course['prices'], value: string) => {
    const price = Number(value);
    if (isNaN(price) || !localCourses) return;
    
    setLocalCourses(prev => 
      prev!.map(c => 
        c.id === courseId 
          ? { ...c, prices: { ...c.prices, [duration]: price } }
          : c
      )
    );
  };
  
  const handleSave = async (courseId: string) => {
    if (!firestore || !localCourses) return;
    const course = localCourses.find(c => c.id === courseId);
    if (!course) return;

    const docRef = doc(firestore, 'courses', courseId);
    await updateDoc(docRef, { prices: course.prices });

    toast({
      title: '저장 완료',
      description: `${course.name}의 가격 정보가 업데이트되었습니다.`,
    });
  };
  
  const getFieldAndClassificationName = (classificationId: string) => {
    const classification = classifications?.find(c => c.id === classificationId);
    if (!classification) return { fieldName: '알수없음', classificationName: '알수없음' };
    
    const field = fields?.find(f => f.id === classification.fieldId);
    return {
        fieldName: field?.name || '알수없는 분야',
        classificationName: classification.name
    };
  }

  const groupedCourses = useMemo(() => {
    if (!localCourses || !classifications) return {};
    
    return localCourses.reduce((acc, course) => {
        const classificationId = course.classificationId;
        if (!acc[classificationId]) {
            acc[classificationId] = [];
        }
        acc[classificationId].push(course);
        return acc;
    }, {} as Record<string, Course[]>);

  }, [localCourses, classifications]);

  const isLoading = coursesLoading || classLoading || fieldsLoading;
  
  if (isLoading || !localCourses) {
    return (
        <Card>
            <CardHeader>
                <Skeleton className="h-8 w-1/2" />
                <Skeleton className="h-4 w-3/4 mt-2" />
            </CardHeader>
            <CardContent>
                <Skeleton className="h-40 w-full" />
            </CardContent>
        </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>상세분류 가격 관리</CardTitle>
        <p className="text-sm text-muted-foreground">각 '상세분류(강좌)'별 이용권 가격을 설정합니다. 큰분류 제목을 클릭하여 펼쳐보세요.</p>
      </CardHeader>
      <CardContent>
        <Accordion type="multiple" className="w-full">
            {Object.entries(groupedCourses).map(([classificationId, coursesInGroup]) => {
                const { fieldName, classificationName } = getFieldAndClassificationName(classificationId);
                return (
                    <AccordionItem value={classificationId} key={classificationId}>
                        <AccordionTrigger className="hover:no-underline">
                            <div className="flex flex-col text-left">
                                <span className="text-sm font-normal text-muted-foreground">{fieldName}</span>
                                <span className="text-lg font-semibold">{classificationName}</span>
                            </div>
                        </AccordionTrigger>
                        <AccordionContent>
                             <Table>
                                <TableHeader>
                                    <TableRow>
                                    <TableHead>상세분류 이름</TableHead>
                                    <TableHead>1일 이용권 (원)</TableHead>
                                    <TableHead>30일 이용권 (원)</TableHead>
                                    <TableHead>60일 이용권 (원)</TableHead>
                                    <TableHead>90일 이용권 (원)</TableHead>
                                    <TableHead className="text-right">저장</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {coursesInGroup.map((item) => (
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
                                    ))}
                                </TableBody>
                            </Table>
                        </AccordionContent>
                    </AccordionItem>
                )
            })}
        </Accordion>
      </CardContent>
    </Card>
  );
}
