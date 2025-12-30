
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
import type { EpisodeViewLog } from '@/lib/types';
import { useCollection, useFirestore, useMemoFirebase } from '@/firebase/hooks';
import { collection, query, orderBy } from 'firebase/firestore';
import { Skeleton } from '@/components/ui/skeleton';
import { toDisplayDate } from '@/lib/date-helpers';

export default function AdminViewHistoryPage() {
  const firestore = useFirestore();

  const viewLogsQuery = useMemoFirebase(
    () => (firestore ? query(collection(firestore, 'episode_view_logs'), orderBy('endedAt', 'desc')) : null),
    [firestore]
  );
  
  const { data: viewLogs, isLoading } = useCollection<EpisodeViewLog>(viewLogsQuery);

  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tight font-headline">시청 기록</h1>
      <p className="text-muted-foreground">전체 사용자의 비디오 시청 기록을 최신순으로 확인합니다.</p>
      
      <Card className="mt-6">
        <CardHeader>
            <div>
              <CardTitle>전체 시청 기록</CardTitle>
              <CardDescription>
                사용자가 비디오 시청을 완료하면 해당 내역이 여기에 실시간으로 표시됩니다.
              </CardDescription>
            </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>사용자</TableHead>
                <TableHead>비디오 제목</TableHead>
                <TableHead>시청 시작 시간</TableHead>
                <TableHead>시청 종료 시간</TableHead>
                <TableHead>총 시청 시간(초)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={5}><Skeleton className="h-8 w-full" /></TableCell>
                  </TableRow>
                ))
              ) : viewLogs && viewLogs.length > 0 ? (
                viewLogs.map((log) => (
                    <TableRow key={log.id}>
                        <TableCell>
                            <div className="font-medium">{log.userName}</div>
                            <div className="text-xs text-muted-foreground">{log.userEmail}</div>
                        </TableCell>
                        <TableCell>{log.episodeTitle}</TableCell>
                        <TableCell>{toDisplayDate(log.startedAt)}</TableCell>
                        <TableCell>{toDisplayDate(log.endedAt)}</TableCell>
                        <TableCell>{log.duration}초</TableCell>
                    </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="text-center h-24">
                    시청 기록이 없습니다.
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
