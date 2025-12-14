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
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { MoreHorizontal, PlusCircle } from 'lucide-react';
import { episodes as mockEpisodes, courses } from '@/lib/data';
import type { Episode } from '@/lib/types';
import VideoUploadDialog from './video-upload-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export default function VideoManager() {
  const [episodes, setEpisodes] = useState<Episode[]>(mockEpisodes);
  const [isUploadDialogOpen, setUploadDialogOpen] = useState(false);

  const getCourseName = (courseId: string) => {
    return courses.find(c => c.id === courseId)?.name || 'N/A';
  };

  const toggleFreeStatus = (episodeId: string) => {
    setEpisodes(prev =>
      prev.map(ep =>
        ep.id === episodeId ? { ...ep, isFree: !ep.isFree } : ep
      )
    );
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>비디오 관리</CardTitle>
            <p className="text-sm text-muted-foreground">개별 에피소드를 업로드하고 관리합니다.</p>
          </div>
          <Button onClick={() => setUploadDialogOpen(true)}>
            <PlusCircle className="mr-2 h-4 w-4" />
            비디오 업로드
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>제목</TableHead>
                <TableHead>소속 상세분류</TableHead>
                <TableHead>재생 시간(초)</TableHead>
                <TableHead>무료 여부</TableHead>
                <TableHead className="text-right">관리</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {episodes.map((episode) => (
                <TableRow key={episode.id}>
                  <TableCell className="font-medium">{episode.title}</TableCell>
                  <TableCell>{getCourseName(episode.courseId)}</TableCell>
                  <TableCell>{episode.duration}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                    <Switch
                      checked={episode.isFree}
                      onCheckedChange={() => toggleFreeStatus(episode.id)}
                      aria-label="Toggle free status"
                    />
                    <Badge variant={episode.isFree ? "secondary" : "outline"}>
                        {episode.isFree ? '무료' : '유료'}
                    </Badge>
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="h-8 w-8 p-0">
                          <span className="sr-only">메뉴 열기</span>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => alert(`수정: ${episode.title}`)}>
                          수정
                        </DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive" onClick={() => alert(`삭제: ${episode.title}`)}>
                          삭제
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <VideoUploadDialog open={isUploadDialogOpen} onOpenChange={setUploadDialogOpen} />
    </>
  );
}
