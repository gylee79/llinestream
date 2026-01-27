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
import { Button } from '@/components/ui/button';
import type { DebugLog } from '@/lib/types';
import { useCollection, useFirestore, useMemoFirebase } from '@/firebase/hooks';
import { collection, query, orderBy, limit, deleteDoc, getDocs } from 'firebase/firestore';
import { Skeleton } from '@/components/ui/skeleton';
import { toDisplayDateTime } from '@/lib/date-helpers';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { Trash2 } from 'lucide-react';

export default function AdminDebugPage() {
  const firestore = useFirestore();
  const { toast } = useToast();

  const logsQuery = useMemoFirebase(
    () => (firestore ? query(collection(firestore, 'debug_logs'), orderBy('timestamp', 'desc'), limit(100)) : null),
    [firestore]
  );
  
  const { data: logs, isLoading } = useCollection<DebugLog>(logsQuery);

  const handleClearLogs = async () => {
    if (!firestore) return;
    toast({ title: '삭제 중...', description: '모든 디버그 로그를 삭제하고 있습니다.' });
    try {
      const logsCollection = collection(firestore, 'debug_logs');
      const snapshot = await getDocs(logsCollection);
      const batch = [];
      for (const doc of snapshot.docs) {
        batch.push(deleteDoc(doc.ref));
      }
      await Promise.all(batch);
      toast({ title: '삭제 완료', description: '모든 디버그 로그가 삭제되었습니다.' });
    } catch (error) {
      console.error("Error clearing logs:", error);
      toast({ variant: 'destructive', title: '삭제 실패', description: '로그 삭제 중 오류가 발생했습니다.' });
    }
  };

  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tight font-headline">디버그 로그</h1>
      <p className="text-muted-foreground">앱 클라이언트에서 발생하는 주요 이벤트를 실시간으로 확인합니다.</p>
      
      <Card className="mt-6">
        <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>이벤트 로그</CardTitle>
              <CardDescription>
                가장 최근 100개의 로그가 표시됩니다. 모바일에서 테스트 후 이 페이지를 새로고침하여 확인하세요.
              </CardDescription>
            </div>
            <Button variant="destructive" size="sm" onClick={handleClearLogs}>
              <Trash2 className="mr-2 h-4 w-4" />
              모든 로그 삭제
            </Button>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[65vh] border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[180px]">타임스탬프</TableHead>
                  <TableHead>이벤트 메시지</TableHead>
                  <TableHead>컨텍스트</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 10 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={3}><Skeleton className="h-8 w-full" /></TableCell>
                    </TableRow>
                  ))
                ) : logs && logs.length > 0 ? (
                  logs.map((log) => (
                      <TableRow key={log.id}>
                          <TableCell className="text-xs">{toDisplayDateTime(log.timestamp)}</TableCell>
                          <TableCell className="text-sm font-medium">{log.message}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            <pre className="whitespace-pre-wrap font-mono">{log.context ? JSON.stringify(log.context, null, 2) : 'N/A'}</pre>
                          </TableCell>
                      </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center h-24">
                      기록된 로그가 없습니다.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
