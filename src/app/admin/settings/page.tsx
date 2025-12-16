
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
import { collection, doc, writeBatch } from 'firebase/firestore';
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from 'react';

export default function AdminSettingsPage() {
  const firestore = useFirestore();
  const { toast } = useToast();
  const policiesQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'policies') : null), [firestore]);
  const { data: policies, isLoading } = useCollection<Policy>(policiesQuery);
  
  const [localPolicies, setLocalPolicies] = useState<Policy[]>([]);

  useEffect(() => {
    if (policies) {
      setLocalPolicies(policies);
    }
  }, [policies]);

  const handlePolicyChange = (slug: string, content: string) => {
    setLocalPolicies(prev => prev.map(p => p.slug === slug ? { ...p, content } : p));
  };

  const handleSaveChanges = async () => {
    if (!firestore) return;
    try {
      const batch = writeBatch(firestore);
      localPolicies.forEach(policy => {
        const docRef = doc(firestore, 'policies', policy.slug);
        batch.update(docRef, { content: policy.content });
      });
      await batch.commit();
      toast({
        title: "저장 완료",
        description: "약관 및 정책이 성공적으로 업데이트되었습니다.",
      });
    } catch (error) {
      console.error("Failed to save policies: ", error);
      toast({
        variant: "destructive",
        title: "저장 실패",
        description: "정책 저장 중 오류가 발생했습니다.",
      });
    }
  };

  const getPolicyContent = (slug: 'terms' | 'privacy' | 'refund') => {
    return localPolicies.find(p => p.slug === slug)?.content || '';
  }
  
  const getPolicyTitle = (slug: 'terms' | 'privacy' | 'refund') => {
    return policies?.find(p => p.slug === slug)?.title || '로딩 중...';
  }

  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tight font-headline">설정</h1>
      <p className="text-muted-foreground">앱의 전반적인 설정을 관리합니다.</p>

      <Tabs defaultValue="policies" className="mt-6">
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
                {isLoading ? ( <p>로딩 중...</p> ) : (
                  <>
                    <div>
                        <Label htmlFor="terms-editor">{getPolicyTitle('terms')}</Label>
                        <Textarea 
                          id="terms-editor" 
                          value={getPolicyContent('terms')} 
                          onChange={(e) => handlePolicyChange('terms', e.target.value)}
                          rows={10} 
                        />
                    </div>
                    <div>
                        <Label htmlFor="privacy-editor">{getPolicyTitle('privacy')}</Label>
                        <Textarea 
                          id="privacy-editor" 
                          value={getPolicyContent('privacy')}
                          onChange={(e) => handlePolicyChange('privacy', e.target.value)}
                          rows={10} 
                        />
                    </div>
                    <div>
                        <Label htmlFor="refund-editor">{getPolicyTitle('refund')}</Label>
                        <Textarea 
                          id="refund-editor" 
                          value={getPolicyContent('refund')}
                          onChange={(e) => handlePolicyChange('refund', e.target.value)}
                          rows={10} 
                        />
                    </div>
                  </>
                )}
                <Button onClick={handleSaveChanges}>저장</Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
