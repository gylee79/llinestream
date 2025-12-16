
'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import type { Policy } from '@/lib/types';
import { useCollection, useFirestore, useMemoFirebase } from '@/firebase';
import { collection } from 'firebase/firestore';

export default function AdminSettingsPage() {
  const firestore = useFirestore();
  const policiesQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'policies') : null), [firestore]);
  const { data: policies } = useCollection<Policy>(policiesQuery);

  const termsPolicy = policies?.find(p => p.id === 'terms');
  const privacyPolicy = policies?.find(p => p.id === 'privacy');
  const refundPolicy = policies?.find(p => p.id === 'refund');

  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tight font-headline">설정</h1>
      <p className="text-muted-foreground">앱의 전반적인 설정을 관리합니다.</p>

      <Tabs defaultValue="general" className="mt-6">
        <TabsList>
          <TabsTrigger value="general">일반</TabsTrigger>
          <TabsTrigger value="footer">푸터</TabsTrigger>
          <TabsTrigger value="policies">약관 및 정책</TabsTrigger>
        </TabsList>
        <TabsContent value="general" className="mt-4">
            <Card>
                <CardHeader><CardTitle>일반 설정</CardTitle></CardHeader>
                <CardContent className="space-y-6">
                    <div className="flex items-center justify-between rounded-lg border p-4">
                        <div>
                            <h3 className="font-medium">유지보수 모드</h3>
                            <p className="text-sm text-muted-foreground">
                                활성화 시, 관리자를 제외한 모든 사용자는 서비스에 접근할 수 없습니다.
                            </p>
                        </div>
                        <Switch />
                    </div>
                    <Button>저장</Button>
                </CardContent>
            </Card>
        </TabsContent>
        <TabsContent value="footer" className="mt-4">
          <Card>
            <CardHeader><CardTitle>푸터 정보 수정</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div><Label>앱 이름</Label><Input defaultValue="LlineStream" /></div>
              <div><Label>슬로건</Label><Input defaultValue="Your daily stream of knowledge and fun." /></div>
              <div><Label>저작권</Label><Input defaultValue="© 2024 LlineStream. All rights reserved." /></div>
              <div><Label>대표자명</Label><Input defaultValue="홍길동" /></div>
              <div><Label>사업자등록번호</Label><Input defaultValue="123-45-67890" /></div>
              <div><Label>주소</Label><Input defaultValue="서울특별시 강남구 테헤란로 123" /></div>
              <div><Label>고객센터 전화번호</Label><Input defaultValue="1588-0000" /></div>
              <div><Label>상담시간</Label><Input defaultValue="평일 09:00 - 18:00" /></div>
              <Button>저장</Button>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="policies" className="mt-4">
        <Card>
            <CardHeader><CardTitle>약관 및 정책 수정</CardTitle></CardHeader>
            <CardContent className="space-y-6">
                {termsPolicy && (
                  <div>
                      <Label htmlFor="terms-editor">{termsPolicy.title}</Label>
                      <Textarea id="terms-editor" defaultValue={termsPolicy.content} rows={10} />
                  </div>
                )}
                {privacyPolicy && (
                  <div>
                      <Label htmlFor="privacy-editor">{privacyPolicy.title}</Label>
                      <Textarea id="privacy-editor" defaultValue={privacyPolicy.content} rows={10} />
                  </div>
                )}
                {refundPolicy && (
                  <div>
                      <Label htmlFor="refund-editor">{refundPolicy.title}</Label>
                      <Textarea id="refund-editor" defaultValue={refundPolicy.content} rows={10} />
                  </div>
                )}
                <Button>저장</Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

    