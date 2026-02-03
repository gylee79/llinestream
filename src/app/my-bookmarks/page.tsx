'use client';

import { useUser, useFirestore, useCollection, useMemoFirebase } from '@/firebase/hooks';
import { collection, query, orderBy } from 'firebase/firestore';
import type { Bookmark } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDuration } from '@/lib/utils';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function MyBookmarksPage() {
  const { user, isUserLoading } = useUser();
  const firestore = useFirestore();

  const bookmarksQuery = useMemoFirebase(() => {
    if (!user || !firestore) return null;
    return query(collection(firestore, 'users', user.id, 'bookmarks'), orderBy('createdAt', 'desc'));
  }, [user, firestore]);

  const { data: bookmarks, isLoading: bookmarksLoading } = useCollection<Bookmark>(bookmarksQuery);

  const isLoading = isUserLoading || bookmarksLoading;

  return (
    <div className="container py-12">
      <header className="mb-8">
        <h1 className="font-headline text-4xl font-bold tracking-tight">나의 책갈피</h1>
        <p className="mt-2 text-lg text-muted-foreground">영상에 저장해둔 모든 책갈피를 확인하세요.</p>
      </header>
      
      <Card>
        <CardHeader>
          <CardTitle>책갈피 목록</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>강의명</TableHead>
                <TableHead>시간</TableHead>
                <TableHead>메모</TableHead>
                <TableHead className="text-right">바로가기</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={4}><Skeleton className="h-8 w-full" /></TableCell>
                  </TableRow>
                ))
              ) : bookmarks && bookmarks.length > 0 ? (
                bookmarks.map((bookmark) => (
                  <TableRow key={bookmark.id}>
                    <TableCell className="font-medium">{bookmark.episodeTitle}</TableCell>
                    <TableCell>{formatDuration(bookmark.timestamp)}</TableCell>
                    <TableCell className="text-muted-foreground">{bookmark.note}</TableCell>
                    <TableCell className="text-right">
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/courses/${bookmark.courseId}?episode=${bookmark.episodeId}`}>
                          강의 보기
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={4} className="h-24 text-center">
                    저장된 책갈피가 없습니다.
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
