
'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import type { Policy, FooterSettings, HeroImageSettings } from '@/lib/types';
import { useCollection, useDoc, useFirestore, useFirebase, errorEmitter, useStorage } from '@/firebase';
import { collection, doc, writeBatch, setDoc } from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect, useMemo } from 'react';
import { Skeleton } from "@/components/ui/skeleton";
import { FirestorePermissionError } from "@/firebase/errors";
import Image from "next/image";

function HeroImageManager() {
    const firestore = useFirestore();
    const storage = useStorage();
    const { authUser } = useFirebase();
    const { toast } = useToast();
    const heroImagesRef = useMemo(() => (firestore ? doc(firestore, 'settings', 'heroImages') : null), [firestore]);
    const { data: heroImageData, isLoading } = useDoc<HeroImageSettings>(heroImagesRef);

    const [settings, setSettings] = useState<Partial<HeroImageSettings>>({});
    const [files, setFiles] = useState<{ home?: File, about?: File }>({});
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        if (heroImageData) {
            setSettings(heroImageData);
        }
    }, [heroImageData]);

    const handleFileChange = (type: 'home' | 'about', file: File | null) => {
        if (file) {
            setFiles(prev => ({ ...prev, [type]: file }));
            // Show preview
            const reader = new FileReader();
            reader.onloadend = () => {
                setSettings(prev => ({
                    ...prev,
                    [type]: { ...prev[type], url: reader.result as string }
                }));
            };
            reader.readAsDataURL(file);
        }
    };

    const handleSave = async () => {
        if (!firestore || !storage) return;
        setIsSaving(true);
        let updatedUrls = { ...settings };

        try {
            for (const key of Object.keys(files) as Array<'home' | 'about'>) {
                const file = files[key];
                if (file) {
                    const storageRef = ref(storage, `settings/hero-${key}/${file.name}`);
                    const uploadTask = uploadBytesResumable(storageRef, file);
                    const downloadUrl = await new Promise<string>((resolve, reject) => {
                        uploadTask.on('state_changed',
                            () => {}, // progress
                            (error) => reject(error),
                            async () => resolve(await getDownloadURL(uploadTask.snapshot.ref))
                        );
                    });
                    updatedUrls[key] = { ...updatedUrls[key], url: downloadUrl };
                }
            }

            await setDoc(doc(firestore, 'settings', 'heroImages'), updatedUrls, { merge: true });
            
            toast({
                title: '저장 완료',
                description: '히어로 이미지가 성공적으로 업데이트되었습니다.',
            });
            setFiles({});
        } catch (error) {
            const contextualError = new FirestorePermissionError({
                path: 'settings/heroImages',
                operation: 'update',
                requestResourceData: updatedUrls,
            }, authUser);
            errorEmitter.emit('permission-error', contextualError);
        } finally {
            setIsSaving(false);
        }
    };
    
    if (isLoading) {
        return <CardContent className="space-y-6">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-40 w-full" />)}</CardContent>;
    }

    return (
        <CardContent className="space-y-6">
            <div className="space-y-2">
                <Label>홈페이지 히어로 이미지</Label>
                {settings.home?.url && <Image src={settings.home.url} alt="Home hero preview" width={500} height={200} className="rounded-md object-cover"/>}
                <Input type="file" onChange={e => handleFileChange('home', e.target.files?.[0] || null)} accept="image/*" />
            </div>
            <div className="space-y-2">
                <Label>아카데미 소개 히어로 이미지</Label>
                {settings.about?.url && <Image src={settings.about.url} alt="About hero preview" width={500} height={200} className="rounded-md object-cover"/>}
                <Input type="file" onChange={e => handleFileChange('about', e.target.files?.[0] || null)} accept="image/*" />
            </div>
            <Button onClick={handleSave} disabled={isSaving}>{isSaving ? '저장 중...' : '저장'}</Button>
        </CardContent>
    );
}

function FooterSettingsManager() {
  const firestore = useFirestore();
  const { authUser } = useFirebase();
  const { toast } = useToast();
  const footerRef = useMemo(() => (firestore ? doc(firestore, 'settings', 'footer') : null), [firestore]);
  const { data: footerData, isLoading } = useDoc<FooterSettings>(footerRef);

  const [settings, setSettings] = useState<Partial<FooterSettings>>({});
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (footerData) {
      setSettings(footerData);
    }
  }, [footerData]);

  const handleChange = (field: keyof FooterSettings, value: string) => {
    setSettings(prev => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    if (!firestore || Object.keys(settings).length === 0) return;
    setIsSaving(true);
    
    const docRef = doc(firestore, 'settings', 'footer');
    const dataToSave = { ...settings, companyName: settings.companyName || '하라생활건강' };

    setDoc(docRef, dataToSave, { merge: true })
      .then(() => {
        toast({
          title: "저장 완료",
          description: "푸터 정보가 성공적으로 업데이트되었습니다.",
        });
      })
      .catch((serverError) => {
        const contextualError = new FirestorePermissionError({
          path: docRef.path,
          operation: 'update',
          requestResourceData: dataToSave,
        }, authUser);
        errorEmitter.emit('permission-error', contextualError);
      })
      .finally(() => {
        setIsSaving(false);
      });
  };

  if (isLoading) {
    return <CardContent className="space-y-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</CardContent>;
  }

  return (
    <CardContent className="space-y-4">
      <div><Label>앱 이름</Label><Input value={settings.appName || ''} onChange={e => handleChange('appName', e.target.value)} /></div>
      <div><Label>슬로건</Label><Input value={settings.slogan || ''} onChange={e => handleChange('slogan', e.target.value)} /></div>
      <div><Label>저작권</Label><Input value={settings.copyright || ''} onChange={e => handleChange('copyright', e.target.value)} /></div>
      <div><Label>상호</Label><Input value={settings.companyName || ''} onChange={e => handleChange('companyName', e.target.value)} /></div>
      <div><Label>대표자명</Label><Input value={settings.representative || ''} onChange={e => handleChange('representative', e.target.value)} /></div>
      <div><Label>사업자등록번호</Label><Input value={settings.businessNumber || ''} onChange={e => handleChange('businessNumber', e.target.value)} /></div>
      <div><Label>주소</Label><Input value={settings.address || ''} onChange={e => handleChange('address', e.target.value)} /></div>
      <div><Label>고객센터 전화번호</Label><Input value={settings.supportPhone || ''} onChange={e => handleChange('supportPhone', e.target.value)} /></div>
      <div><Label>상담시간</Label><Input value={settings.supportHours || ''} onChange={e => handleChange('supportHours', e.target.value)} /></div>
      <div><Label>카카오톡 상담 URL</Label><Input value={settings.kakaoTalkUrl || ''} onChange={e => handleChange('kakaoTalkUrl', e.target.value)} placeholder="https://pf.kakao.com/_xxxxxx" /></div>
      <Button onClick={handleSave} disabled={isSaving}>{isSaving ? '저장 중...' : '저장'}</Button>
    </CardContent>
  );
}

function PolicySettingsManager() {
  const firestore = useFirestore();
  const { toast } = useToast();
  const policiesQuery = useMemo(() => (firestore ? collection(firestore, 'policies') : null), [firestore]);
  const { data: policies, isLoading } = useCollection<Policy>(policiesQuery);
  
  const [localPolicies, setLocalPolicies] = useState<Policy[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (policies) {
      setLocalPolicies(policies);
    }
  }, [policies]);

  const handlePolicyChange = (slug: string, content: string) => {
    setLocalPolicies(prev => prev.map(p => p.slug === slug ? { ...p, content } : p));
  };

  const handleSaveChanges = async () => {
    if (!firestore || localPolicies.length === 0) return;
    setIsSaving(true);
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
    } finally {
      setIsSaving(false);
    }
  };

  const getPolicyContent = (slug: 'terms' | 'privacy' | 'refund') => {
    return localPolicies.find(p => p.slug === slug)?.content || '';
  }
  
  const getPolicyTitle = (slug: 'terms' | 'privacy' | 'refund') => {
    return policies?.find(p => p.slug === slug)?.title || '로딩 중...';
  }

  return (
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
                  disabled={isSaving}
                />
            </div>
            <div>
                <Label htmlFor="privacy-editor">{getPolicyTitle('privacy')}</Label>
                <Textarea 
                  id="privacy-editor" 
                  value={getPolicyContent('privacy')}
                  onChange={(e) => handlePolicyChange('privacy', e.target.value)}
                  rows={10}
                  disabled={isSaving}
                />
            </div>
            <div>
                <Label htmlFor="refund-editor">{getPolicyTitle('refund')}</Label>
                <Textarea 
                  id="refund-editor" 
                  value={getPolicyContent('refund')}
                  onChange={(e) => handlePolicyChange('refund', e.target.value)}
                  rows={10}
                  disabled={isSaving}
                />
            </div>
          </>
        )}
        <Button onClick={handleSaveChanges} disabled={isSaving}>{isSaving ? '저장 중...' : '저장'}</Button>
    </CardContent>
  );
}


export default function AdminSettingsPage() {
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
                <CardHeader><CardTitle>히어로 이미지 설정</CardTitle></CardHeader>
                <HeroImageManager />
            </Card>
            <Card className="mt-6">
                <CardHeader><CardTitle>유지보수 모드</CardTitle></CardHeader>
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
            <FooterSettingsManager />
          </Card>
        </TabsContent>
        <TabsContent value="policies" className="mt-4">
        <Card>
            <CardHeader><CardTitle>약관 및 정책 수정</CardTitle></CardHeader>
            <PolicySettingsManager />
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
