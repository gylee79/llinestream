'use client';

import { useState } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { EpisodeViewLog, Episode, User } from '@/lib/types';
import { useCollection, useFirestore, useMemoFirebase } from '@/firebase/hooks';
import { collection, query, orderBy, where, Timestamp } from 'firebase/firestore';
import { Skeleton } from '@/components/ui/skeleton';
import { toDisplayDate, toDisplayTime } from '@/lib/date-helpers';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarIcon } from 'lucide-react';
import { Calendar } from '@/components/ui/calendar';
import { DateRange } from 'react-day-picker';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

export default function AdminViewHistoryPage() {
  const firestore = useFirestore();
  
  const [filterUser, setFilterUser] = useState('all');
  const [filterEpisode, setFilterEpisode] = useState('all');
  const [dateRange, setDateRange] = useState<DateRange | undefined>();

  // Fetch data for filters
  const usersQuery = useMemoFirebase(() => firestore ? collection(firestore, 'users') : null, [firestore]);
  const { data: users, isLoading: usersLoading } = useCollection<User>(usersQuery);
  
  const episodesQuery = useMemoFirebase(() => firestore ? collection(firestore, 'episodes') : null, [firestore]);
  const { data: episodes, isLoading: episodesLoading } = useCollection<Episode>(episodesQuery);

  // Query the global collection for admin auditing
  const viewLogsQuery = useMemoFirebase(
    () => {
      if (!firestore) return null;
      let q: any = query(collection(firestore, 'episode_view_logs'), orderBy('endedAt', 'desc'));

      if (filterUser !== 'all') {
        q = query(q, where('userId', '==', filterUser));
      }
      if (filterEpisode !== 'all') {
        q = query(q, where('episodeId', '==', filterEpisode));
      }
      if (dateRange?.from) {
        q = query(q, where('endedAt', '>=', Timestamp.fromDate(dateRange.from)));
      }
      if (dateRange?.to) {
        // To include the whole 'to' day, we set the time to the end of the day.
        const toDate = new Date(dateRange.to);
        toDate.setHours(23, 59, 59, 999);
        q = query(q, where('endedAt', '<=', Timestamp.fromDate(toDate)));
      }
      return q;
    },
    [firestore, filterUser, filterEpisode, dateRange]
  );
  
  const { data: viewLogs, isLoading: logsLoading } = useCollection<EpisodeViewLog>(viewLogsQuery);
  
  const isLoading = usersLoading || episodesLoading || logsLoading;

  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tight font-headline">시청 기록</h1>
      <p className="text-muted-foreground">전체 사용자의 비디오 시청 기록을 최신순으로 확인하고 필터링합니다.</p>
      
      <Card className="mt-6">
        <CardHeader>
            <div>
              <CardTitle>전체 시청 기록</CardTitle>
              <CardDescription>
                사용자, 비디오 제목, 날짜별로 시청 기록을 필터링할 수 있습니다.
              </CardDescription>
            </div>
             <div className="flex flex-wrap items-center gap-4 mt-4">
                <Select value={filterUser} onValueChange={setFilterUser} disabled={isLoading}>
                    <SelectTrigger className="w-[180px]"><SelectValue placeholder="모든 사용자" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">모든 사용자</SelectItem>
                        {users?.map(u => <SelectItem key={u.id} value={u.id}>{u.name || u.email}</SelectItem>)}
                    </SelectContent>
                </Select>
                <Select value={filterEpisode} onValueChange={setFilterEpisode} disabled={isLoading}>
                    <SelectTrigger className="w-[180px]"><SelectValue placeholder="모든 비디오" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">모든 비디오</SelectItem>
                        {episodes?.map(e => <SelectItem key={e.id} value={e.id}>{e.title}</SelectItem>)}
                    </SelectContent>
                </Select>
                <Popover>
                    <PopoverTrigger asChild>
                    <Button
                        id="date"
                        variant={"outline"}
                        className={cn(
                        "w-[260px] justify-start text-left font-normal",
                        !dateRange && "text-muted-foreground"
                        )}
                    >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {dateRange?.from ? (
                        dateRange.to ? (
                            <>
                            {format(dateRange.from, "LLL dd, y")} -{" "}
                            {format(dateRange.to, "LLL dd, y")}
                            </>
                        ) : (
                            format(dateRange.from, "LLL dd, y")
                        )
                        ) : (
                        <span>날짜 선택</span>
                        )}
                    </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                        initialFocus
                        mode="range"
                        defaultMonth={dateRange?.from}
                        selected={dateRange}
                        onSelect={setDateRange}
                        numberOfMonths={2}
                    />
                    </PopoverContent>
                </Popover>
            </div>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[65vh]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>날짜</TableHead>
                  <TableHead>사용자 이름</TableHead>
                  <TableHead>이메일</TableHead>
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
                      <TableCell colSpan={7}><Skeleton className="h-8 w-full" /></TableCell>
                    </TableRow>
                  ))
                ) : viewLogs && viewLogs.length > 0 ? (
                  viewLogs.map((log) => (
                      <TableRow key={log.id}>
                          <TableCell>{toDisplayDate(log.endedAt)}</TableCell>
                          <TableCell className="font-medium">{log.userName}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{log.userEmail}</TableCell>
                          <TableCell>{log.episodeTitle}</TableCell>
                          <TableCell>{toDisplayTime(log.startedAt)}</TableCell>
                          <TableCell>{toDisplayTime(log.endedAt)}</TableCell>
                          <TableCell>{log.duration}초</TableCell>
                      </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center h-24">
                      선택된 조건에 맞는 시청 기록이 없습니다.
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
