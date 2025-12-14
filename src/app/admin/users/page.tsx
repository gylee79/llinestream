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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search } from 'lucide-react';
import type { User } from '@/lib/types';
import { UserDetailsDialog } from '@/components/admin/users/user-details-dialog';
import { useCollection, useFirestore, useMemoFirebase } from '@/firebase';
import { collection } from 'firebase/firestore';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';

export default function AdminUsersPage() {
  const firestore = useFirestore();
  const usersQuery = useMemoFirebase(() => collection(firestore, 'users'), [firestore]);
  const { data: users, isLoading } = useCollection<User>(usersQuery);

  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [isDialogOpen, setDialogOpen] = useState(false);

  const getActiveSubscriptions = (user: User) => {
    if (!user.activeSubscriptions) return '없음';
    const subCount = Object.keys(user.activeSubscriptions).length;
    if (subCount === 0) return '없음';
    return `${subCount}개 활성`;
  };

  const getFinalExpiry = (user: User) => {
    if (!user.activeSubscriptions) return 'N/A';
    const dates = Object.values(user.activeSubscriptions).map(s => s.expiresAt.toDate().getTime());
    if (dates.length === 0) return 'N/A';
    const maxDate = new Date(Math.max(...dates));
    return maxDate.toLocaleDateString();
  };

  const openDetails = (user: User) => {
    setSelectedUser(user);
    setDialogOpen(true);
  };
  
  return (
    <>
      <div>
        <h1 className="text-3xl font-bold tracking-tight font-headline">고객 관리</h1>
        <p className="text-muted-foreground">전체 사용자 목록을 확인하고 관리합니다.</p>

        <Card className="mt-6">
          <CardHeader>
            <CardTitle>사용자 목록</CardTitle>
            <div className="relative ml-auto flex-1 md:grow-0">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder="이름 또는 이메일로 검색..."
                className="w-full rounded-lg bg-background pl-8 md:w-[200px] lg:w-[320px]"
              />
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>이름</TableHead>
                  <TableHead>이메일</TableHead>
                  <TableHead>역할</TableHead>
                  <TableHead>가입일</TableHead>
                  <TableHead>활성 구독</TableHead>
                  <TableHead>최종 만료일</TableHead>
                  <TableHead className="text-right">관리</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={7}>
                        <Skeleton className="h-8 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  users?.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium">{user.name || 'N/A'}</TableCell>
                      <TableCell>{user.email}</TableCell>
                      <TableCell>
                        <Badge variant={user.role === 'admin' ? 'default' : 'secondary'}>
                          {user.role}
                        </Badge>
                      </TableCell>
                      <TableCell>{user.createdAt?.toDate().toLocaleDateString() || 'N/A'}</TableCell>
                      <TableCell>{getActiveSubscriptions(user)}</TableCell>
                      <TableCell>{getFinalExpiry(user)}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="outline" size="sm" onClick={() => openDetails(user)}>수정</Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
      {selectedUser && (
        <UserDetailsDialog user={selectedUser} open={isDialogOpen} onOpenChange={setDialogOpen} />
      )}
    </>
  );
}

    