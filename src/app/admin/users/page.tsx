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
import type { User, Course } from '@/lib/types';
import { UserDetailsDialog } from '@/components/admin/users/user-details-dialog';
import { useCollection, useFirestore, useMemoFirebase } from '@/firebase/hooks';
import { collection } from 'firebase/firestore';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { toDisplayDate, toJSDate } from '@/lib/date-helpers';

export default function AdminUsersPage() {
  const firestore = useFirestore();
  const usersQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'users') : null), [firestore]);
  const { data: users, isLoading: usersLoading } = useCollection<User>(usersQuery);

  const coursesQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'courses') : null), [firestore]);
  const { data: courses, isLoading: coursesLoading } = useCollection<Course>(coursesQuery);

  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [isDialogOpen, setDialogOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const getActiveSubscriptions = (user: User) => {
    if (coursesLoading) return '로딩 중...';
    if (!user.activeSubscriptions || !courses) return '없음';

    const activeSubIds = Object.keys(user.activeSubscriptions);
    if (activeSubIds.length === 0) return '없음';
    
    const subNames = activeSubIds
      .map(id => courses.find(c => c.id === id)?.name)
      .filter(Boolean); // Filter out undefined names

    if (subNames.length === 0) return '없음';
    
    return (
      <div className="flex flex-wrap gap-1">
        {subNames.map(name => <Badge key={name} variant="secondary">{name}</Badge>)}
      </div>
    );
  };

  const getFinalExpiry = (user: User) => {
    if (!user.activeSubscriptions) return 'N/A';
    const dates = Object.values(user.activeSubscriptions).map(s => toJSDate(s.expiresAt).getTime());
    if (dates.length === 0) return 'N/A';
    const maxDate = new Date(Math.max(...dates));
    return maxDate.toLocaleDateString('ko-KR');
  };

  const openDetails = (user: User) => {
    setSelectedUser(user);
    setDialogOpen(true);
  };
  
  const filteredUsers = users?.filter(user => 
    user.name?.toLowerCase().includes(searchTerm.toLowerCase()) || 
    user.email?.toLowerCase().includes(searchTerm.toLowerCase())
  );
  
  const isLoading = usersLoading || coursesLoading;

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
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>이름</TableHead>
                  <TableHead>이메일</TableHead>
                  <TableHead>연락처</TableHead>
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
                      <TableCell colSpan={8}>
                        <Skeleton className="h-8 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  filteredUsers?.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium">{user.name || 'N/A'}</TableCell>
                      <TableCell>{user.email}</TableCell>
                      <TableCell>{user.phone}</TableCell>
                      <TableCell>
                        <Badge variant={user.role === 'admin' ? 'default' : 'secondary'}>
                          {user.role}
                        </Badge>
                      </TableCell>
                      <TableCell>{toDisplayDate(user.createdAt) || 'N/A'}</TableCell>
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
      {selectedUser && courses && (
        <UserDetailsDialog 
            user={selectedUser} 
            open={isDialogOpen} 
            onOpenChange={setDialogOpen}
            courses={courses}
        />
      )}
    </>
  );
}
