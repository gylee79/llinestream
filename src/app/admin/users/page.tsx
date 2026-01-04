
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
import type { User, Course, UserAuditLog } from '@/lib/types';
import { UserDetailsDialog } from '@/components/admin/users/user-details-dialog';
import { useCollection, useFirestore, useMemoFirebase } from '@/firebase/hooks';
import { collection, query, orderBy } from 'firebase/firestore';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { toDisplayDate } from '@/lib/date-helpers';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

function UserListTab() {
  const firestore = useFirestore();
  const usersQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'users') : null), [firestore]);
  const { data: users, isLoading: usersLoading } = useCollection<User>(usersQuery);

  const coursesQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'courses'), orderBy('createdAt', 'desc')) : null), [firestore]);
  const { data: courses, isLoading: coursesLoading } = useCollection<Course>(coursesQuery);

  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [isDialogOpen, setDialogOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const getActiveSubscriptions = (user: User) => {
    if (coursesLoading) return '로딩 중...';
    if (!user.activeSubscriptions || !courses) return '없음';
  
    const activeSubs = Object.entries(user.activeSubscriptions);
    if (activeSubs.length === 0) return '없음';
  
    const subDetails = activeSubs.map(([courseId, subData]) => {
      const courseName = courses.find(c => c.id === courseId)?.name;
      if (!courseName) return null;
      return {
        name: courseName,
        expiresAt: toDisplayDate(subData.expiresAt),
      };
    }).filter(Boolean);
  
    if (subDetails.length === 0) return '없음';
  
    return (
      <div className="flex flex-wrap gap-1">
        {subDetails.map((sub, index) => (
          sub && <Badge key={index} variant="secondary">
            {sub.name} ({sub.expiresAt})
          </Badge>
        ))}
      </div>
    );
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
      <Card>
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
                <TableHead>활성 구독 (만료일)</TableHead>
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

function AuditLogTab() {
    const firestore = useFirestore();
    const auditLogQuery = useMemoFirebase(() => (
        firestore ? query(collection(firestore, 'user_audit_logs'), orderBy('changedAt', 'desc')) : null
    ), [firestore]);
    const { data: auditLogs, isLoading } = useCollection<UserAuditLog>(auditLogQuery);

    const fieldNameMap: Record<string, string> = {
        name: '이름',
        phone: '연락처',
        dob: '생년월일'
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>사용자 정보 수정 기록</CardTitle>
                <p className="text-sm text-muted-foreground">사용자가 프로필에서 정보를 변경한 모든 내역입니다.</p>
            </CardHeader>
            <CardContent>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>변경일</TableHead>
                            <TableHead>사용자</TableHead>
                            <TableHead>변경 항목</TableHead>
                            <TableHead>변경 전</TableHead>
                            <TableHead>변경 후</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {isLoading ? (
                            Array.from({ length: 5 }).map((_, i) => (
                                <TableRow key={i}>
                                    <TableCell colSpan={5}><Skeleton className="h-8 w-full" /></TableCell>
                                </TableRow>
                            ))
                        ) : auditLogs && auditLogs.length > 0 ? (
                            auditLogs.map(log => (
                                <TableRow key={log.id}>
                                    <TableCell>{toDisplayDate(log.changedAt)}</TableCell>
                                    <TableCell>
                                        <div className="font-medium">{log.userName}</div>
                                        <div className="text-xs text-muted-foreground">{log.userEmail}</div>
                                    </TableCell>
                                    <TableCell>{fieldNameMap[log.fieldName] || log.fieldName}</TableCell>
                                    <TableCell>{log.oldValue}</TableCell>
                                    <TableCell className="font-semibold text-primary">{log.newValue}</TableCell>
                                </TableRow>
                            ))
                        ) : (
                            <TableRow>
                                <TableCell colSpan={5} className="text-center h-24">수정 기록이 없습니다.</TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </CardContent>
        </Card>
    );
}

export default function AdminUsersPage() {
  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tight font-headline">고객 관리</h1>
      <p className="text-muted-foreground">전체 사용자 목록을 확인하고 관리합니다.</p>

      <Tabs defaultValue="user-list" className="mt-6">
        <TabsList>
            <TabsTrigger value="user-list">사용자 목록</TabsTrigger>
            <TabsTrigger value="audit-log">사용자 정보 수정 기록</TabsTrigger>
        </TabsList>
        <TabsContent value="user-list">
            <UserListTab />
        </TabsContent>
        <TabsContent value="audit-log">
            <AuditLogTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
