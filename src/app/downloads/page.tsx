
'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { DownloadCloud, Play, Trash2, AlertTriangle, BadgeHelp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
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
import { useToast } from '@/hooks/use-toast';
import { toDisplayDate } from '@/lib/date-helpers';
import { isAfter } from 'date-fns';
import { getDownloadedVideo, listDownloadedVideos, deleteVideo } from '@/lib/offline-db';
import type { OfflineVideoInfo, OfflineVideoData } from '@/lib/types';
import VideoPlayerDialog from '@/components/shared/video-player-dialog';

export default function DownloadsPage() {
  const { toast } = useToast();
  const [videos, setVideos] = useState<OfflineVideoInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [videoToPlay, setVideoToPlay] = useState<OfflineVideoData | null>(null);
  const [videoToDelete, setVideoToDelete] = useState<OfflineVideoInfo | null>(null);

  useEffect(() => {
    const loadVideos = async () => {
      setIsLoading(true);
      try {
        const videoList = await listDownloadedVideos();
        setVideos(videoList);
      } catch (error) {
        toast({ variant: 'destructive', title: '오류', description: '다운로드한 비디오 목록을 불러오지 못했습니다.' });
      } finally {
        setIsLoading(false);
      }
    };
    loadVideos();
  }, [toast]);

  const handlePlay = async (episodeId: string) => {
    try {
      const fullData = await getDownloadedVideo(episodeId);
      if (fullData) {
        setVideoToPlay(fullData);
      } else {
        throw new Error('비디오 데이터를 찾을 수 없습니다.');
      }
    } catch (error: any) {
      toast({ variant: 'destructive', title: '재생 실패', description: error.message });
    }
  };
  
  const handleDeleteConfirm = async () => {
    if (!videoToDelete) return;
    try {
        await deleteVideo(videoToDelete.episodeId);
        setVideos(prev => prev.filter(v => v.episodeId !== videoToDelete.episodeId));
        toast({ title: '삭제 완료', description: `'${videoToDelete.title}' 영상이 삭제되었습니다.` });
    } catch (error: any) {
        toast({ variant: 'destructive', title: '삭제 실패', description: error.message });
    } finally {
        setVideoToDelete(null);
    }
  }

  return (
    <>
      <div className="container mx-auto py-12">
        <header className="mb-8">
          <h1 className="text-4xl font-bold font-headline tracking-tight">다운로드함</h1>
          <p className="mt-4 text-lg text-muted-foreground">
            다운로드한 콘텐츠를 오프라인 상태에서도 시청할 수 있습니다. (최대 7일)
          </p>
        </header>
        
        <Card>
            <CardHeader>
                <CardTitle>내 보관함</CardTitle>
                <CardDescription>총 {videos.length}개의 영상이 보관되어 있습니다.</CardDescription>
            </CardHeader>
            <CardContent>
                {isLoading ? (
                     <div className="space-y-4">
                        <Skeleton className="h-24 w-full" />
                        <Skeleton className="h-24 w-full" />
                     </div>
                ) : videos.length > 0 ? (
                    <div className="space-y-4">
                        {videos.map(video => {
                            const isExpired = isAfter(new Date(), video.expiresAt);
                            return (
                                <Card key={video.episodeId} className="flex items-center p-3 gap-4">
                                    <div className="relative w-28 h-16 rounded-md overflow-hidden bg-muted flex-shrink-0">
                                        <Image src={video.thumbnailUrl} alt={video.title} fill sizes="112px" className="object-cover" />
                                    </div>
                                    <div className="flex-grow min-w-0">
                                        <p className="font-semibold truncate">{video.title}</p>
                                        <p className="text-sm text-muted-foreground truncate">{video.courseName}</p>
                                        <p className="text-xs text-muted-foreground mt-1">만료일: {toDisplayDate(video.expiresAt)}</p>
                                    </div>
                                    <div className="flex items-center gap-2 flex-shrink-0">
                                        {isExpired ? (
                                            <div className="flex items-center gap-2 text-destructive">
                                                <AlertTriangle className="h-5 w-5" />
                                                <span className="text-sm font-medium">기간 만료</span>
                                            </div>
                                        ) : (
                                            <Button size="sm" onClick={() => handlePlay(video.episodeId)}>
                                                <Play className="h-4 w-4 mr-2"/>
                                                재생
                                            </Button>
                                        )}
                                        <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => setVideoToDelete(video)}>
                                            <Trash2 className="h-4 w-4"/>
                                        </Button>
                                    </div>
                                </Card>
                            )
                        })}
                    </div>
                ) : (
                    <div className="h-60 flex flex-col items-center justify-center text-center border-2 border-dashed rounded-lg">
                        <DownloadCloud className="h-12 w-12 text-muted-foreground" />
                        <h3 className="mt-4 text-lg font-semibold">보관함이 비어있습니다.</h3>
                        <p className="mt-1 text-sm text-muted-foreground">보고싶은 영상을 다운로드하여 언제 어디서든 즐겨보세요.</p>
                        <Button asChild variant="outline" className="mt-4">
                            <Link href="/contents">영상 보러가기</Link>
                        </Button>
                    </div>
                )}
            </CardContent>
        </Card>
      </div>

        {videoToPlay && (
             <VideoPlayerDialog
                isOpen={!!videoToPlay}
                onOpenChange={(isOpen) => !isOpen && setVideoToPlay(null)}
                episode={videoToPlay.episode}
                offlineVideoData={videoToPlay}
            />
        )}

        <AlertDialog open={!!videoToDelete} onOpenChange={(isOpen) => !isOpen && setVideoToDelete(null)}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>정말 삭제하시겠습니까?</AlertDialogTitle>
                    <AlertDialogDescription>
                       &apos;{videoToDelete?.title}&apos; 영상을 보관함에서 삭제합니다. 이 작업은 되돌릴 수 없습니다.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>취소</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDeleteConfirm}>삭제</AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    </>
  );
}
