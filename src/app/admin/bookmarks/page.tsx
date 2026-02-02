
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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
  } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { Bookmark, Episode, User } from '@/lib/types';
import { useCollection, useFirestore, useMemoFirebase, useUser } from '@/firebase/hooks';
import { collection, query, orderBy, where } from 'firebase/firestore';
import { Skeleton } from '@/components/ui/skeleton';
import { toDisplayDateTime } from '@/lib/date-helpers';
import { Button } from '@/components/ui/button';
import { deleteBookmark } from '@/lib/actions/bookmark-actions';
import { useToast } from '@/hooks/use-toast';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Trash2 } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';

function BookmarkLogViewer() {
  const firestore = useFirestore();
  const { toast } = useToast();

  const [filterEpisode, setFilterEpisode] = useState('all');
  const [filterUser, setFilterUser] = useState('all');

  const episodesQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'episodes') : null), [firestore]);
  const { data: episodes, isLoading: episodesLoading } = useCollection<Episode>(episodesQuery);
  
  const usersQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'users') : null), [firestore]);
  const { data: users, isLoading: usersLoading } = useCollection<User>(usersQuery);
  
  const bookmarksQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    let q: any = query(collection(firestore, 'bookmarks'), orderBy('createdAt', 'desc'));
    if (filterEpisode !== 'all') {
      q = query(q, where('episodeId', '==', filterEpisode));
    }
    if (filterUser !== 'all') {
      q = query(q, where('userId', '==', filterUser));
    }
    return q;
  }, [firestore, filterEpisode, filterUser]);

  const { data: bookmarks, isLoading: bookmarksLoading } = useCollection<Bookmark>(bookmarksQuery);

  const isLoading = episodesLoading || usersLoading || bookmarksLoading;
  
  const formatTime = (seconds: number) => {
    if (isNaN(seconds) || seconds < 0) return '00:00:00';
    const date = new Date(0);
    date.setSeconds(seconds);
    return date.toISOString().substr(11, 8); // HH:MM:SS
  };


  const handleDelete = async (userId: string, bookmarkId: string) => {
    const result = await deleteBookmark(userId, bookmarkId);
    if (result.success) {
      toast({ title: '삭제 완료', description: '북마크 기록이 삭제되었습니다.' });
    } else {
      toast({ variant: 'destructive', title: '삭제 실패', description: result.message });
    }
  };

  return (
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>전체 북마크 기록</CardTitle>
          <CardDescription>
            <div className="flex gap-4 mt-2">
                <Select value={filterEpisode} onValueChange={setFilterEpisode} disabled={isLoading}>
                    <SelectTrigger className="w-[200px]"><SelectValue placeholder="모든 에피소드" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">모든 에피소드</SelectItem>
                        {episodes?.map(e => <SelectItem key={e.id} value={e.id}>{e.title}</SelectItem>)}
                    </SelectContent>
                </Select>
                 <Select value={filterUser} onValueChange={setFilterUser} disabled={isLoading}>
                    <SelectTrigger className="w-[200px]"><SelectValue placeholder="모든 사용자" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">모든 사용자</SelectItem>
                        {users?.map(u => <SelectItem key={u.id} value={u.id}>{u.name || u.email}</SelectItem>)}
                    </SelectContent>
                </Select>
            </div>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[65vh]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[150px]">날짜</TableHead>
                  <TableHead className="w-[120px]">사용자</TableHead>
                  <TableHead className="w-[200px]">에피소드</TableHead>
                  <TableHead className="w-[100px]">시간</TableHead>
                  <TableHead>메모</TableHead>
                  <TableHead className="w-[80px] text-right">관리</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 10 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={6}><Skeleton className="h-12 w-full" /></TableCell>
                    </TableRow>
                  ))
                ) : bookmarks && bookmarks.length > 0 ? (
                  bookmarks.map((log) => (
                      <TableRow key={log.id}>
                          <TableCell className="text-xs">{toDisplayDateTime(log.createdAt)}</TableCell>
                          <TableCell className="text-sm font-medium">{log.userName}</TableCell>
                          <TableCell className="text-sm">{log.episodeTitle}</TableCell>
                          <TableCell className="font-mono text-sm">{formatTime(log.timestamp)}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{log.note}</TableCell>
                          <TableCell className="text-right">
                              <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                      <Button variant="destructive" size="icon" className="h-8 w-8">
                                          <Trash2 className="h-4 w-4" />
                                      </Button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                      <AlertDialogHeader>
                                          <AlertDialogTitle>정말 삭제하시겠습니까?</AlertDialogTitle>
                                          <AlertDialogDescription>
                                              이 북마크 기록을 영구적으로 삭제합니다. 이 작업은 되돌릴 수 없습니다.
                                          </AlertDialogDescription>
                                      </AlertDialogHeader>
                                      <AlertDialogFooter>
                                          <AlertDialogCancel>취소</AlertDialogCancel>
                                          <AlertDialogAction onClick={() => handleDelete(log.userId, log.id)}>삭제</AlertDialogAction>
                                      </AlertDialogFooter>
                                  </AlertDialogContent>
                              </AlertDialog>
                          </TableCell>
                      </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center h-24">
                      북마크 기록이 없습니다.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>
  )
}

export default function AdminBookmarksPage() {
  const { user, isUserLoading } = useUser();
  const isAdmin = user?.role === 'admin';

  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tight font-headline">북마크 관리</h1>
      <p className="text-muted-foreground">사용자들의 북마크 기록을 관리합니다.</p>
      
      {isUserLoading ? (
        <Card className="mt-6">
          <CardHeader><Skeleton className="h-8 w-1/4" /></CardHeader>
          <CardContent>
            <Skeleton className="h-64 w-full" />
          </CardContent>
        </Card>
      ) : isAdmin ? (
        <BookmarkLogViewer />
      ) : (
        // Non-admin users are handled by the layout, but as a fallback:
        <Card className="mt-6">
          <CardContent className="pt-6">
            <p>이 콘텐츠를 볼 권한이 없습니다.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
