'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { uploadMockData } from '@/lib/data-uploader';
import { useToast } from '@/hooks/use-toast';

export default function DataUploadPage() {
  const [isUploading, setIsUploading] = useState(false);
  const { toast } = useToast();

  const handleUpload = async () => {
    setIsUploading(true);
    try {
      const result = await uploadMockData();
      if (result.success) {
        toast({
          title: '업로드 성공',
          description: '모든 목업 데이터가 Firestore에 성공적으로 업로드되었습니다.',
        });
      } else {
        throw new Error(result.message);
      }
    } catch (error) {
        console.error(error);
        const errorMessage = error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
        toast({
            variant: 'destructive',
            title: '업로드 실패',
            description: errorMessage,
        });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tight font-headline">데이터 업로드 유틸리티</h1>
      <p className="text-muted-foreground">앱의 초기 목업 데이터를 Firestore에 업로드합니다.</p>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>목업 데이터 Firestore에 업로드</CardTitle>
          <CardDescription>
            이 버튼을 클릭하면 `src/lib/data.ts`에 정의된 모든 목업 데이터(분야, 분류, 강좌, 에피소드)가 Firestore 데이터베이스에 업로드됩니다.
            이 작업은 데이터베이스를 덮어쓰지 않으며, 동일한 ID의 문서가 이미 있는 경우 해당 문서를 업데이트합니다.
            앱을 처음 설정할 때 한 번만 실행하는 것이 좋습니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={handleUpload} disabled={isUploading}>
            {isUploading ? '업로드 중...' : 'Firestore에 데이터 업로드'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
