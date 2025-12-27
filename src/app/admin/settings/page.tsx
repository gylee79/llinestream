
'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import type { Policy, FooterSettings, HeroImageSettings } from '@/lib/types';
import { useCollection, useDoc, useFirestore, useUser, errorEmitter, useStorage, useMemoFirebase } from '@/firebase';
import { collection, doc, updateDoc, setDoc } from 'firebase/firestore';
import { ref, uploadBytesResumable } from 'firebase/storage';
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect, useRef } from 'react';
import { Skeleton } from "@/components/ui/skeleton";
import Image from "next/image";
import { Separator } from "@/components/ui/separator";
import { getPublicUrl } from "@/lib/utils";


function HeroImageManager() {
    const firestore = useFirestore();
    const storage = useStorage();
    const { user } = useUser();
    const { toast } = useToast();
    const heroImagesRef = useMemoFirebase(() => (firestore ? doc(firestore, 'settings', 'heroImages') : null), [firestore]);
    const { data: heroImageData, isLoading } = useDoc<HeroImageSettings>(heroImagesRef);

    const [settings, setSettings] = useState<Partial<HeroImageSettings>>({ home: {}, about: {} });
    const [files, setFiles] = useState<{ home?: File, about?: File, homeMobile?: File, aboutMobile?: File }>({});
    const [isSaving, setIsSaving] = useState(false);
    
    const originalUrls = useRef<{ home?: string, about?: string, homeMobile?: string, aboutMobile?: string }>({});

    useEffect(() => {
        if (heroImageData) {
            setSettings(heroImageData);
            originalUrls.current = {
                home: heroImageData.home?.url,
                about: heroImageData.about?.url,
                homeMobile: heroImageData.home?.urlMobile,
                aboutMobile: heroImageData.about?.urlMobile,
            };
        }
    }, [heroImageData]);
    
    type FileType = 'home' | 'about' | 'homeMobile' | 'aboutMobile';

    const handleFileChange = (type: FileType, file: File | null) => {
        if (file) {
            setFiles(prev => ({ ...prev, [type]: file }));
            const reader = new FileReader();
            reader.onloadend = () => {
                const page = type.startsWith('home') ? 'home' : 'about';
                const device = type.endsWith('Mobile') ? 'urlMobile' : 'url';
                setSettings(prev => ({
                    ...prev,
                    [page]: { ...(prev[page] || {}), [device]: reader.result as string }
                }));
            };
            reader.readAsDataURL(file);
        }
    };
    
    const handleCancelFileChange = (type: FileType) => {
        setFiles(prev => {
            const newFiles = { ...prev };
            delete newFiles[type];
            return newFiles;
        });

        const page = type.startsWith('home') ? 'home' : 'about';
        const deviceUrlProp = type.endsWith('Mobile') ? 'urlMobile' : 'url';
        const originalUrlProp = (type.endsWith('Mobile') ? `${page}Mobile` : page) as keyof typeof originalUrls.current;

        setSettings(prev => ({
            ...prev,
            [page]: { ...(prev[page] || {}), [deviceUrlProp]: originalUrls.current[originalUrlProp] }
        }));
    };
    
    const handleTextChange = (type: 'home' | 'about', field: 'title' | 'description', value: string) => {
      setSettings(prev => ({
        ...prev,
        [type]: { ...(prev[type] || {}), [field]: value }
      }));
    };

    const handleSave = async () => {
        if (!firestore || !storage || !user) return;
        setIsSaving(true);
        
        let updatedSettings: Partial<HeroImageSettings> = JSON.parse(JSON.stringify(settings));

        try {
            const bucketName = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
            if (!bucketName) {
                throw new Error('Firebase Storage bucket name is not configured in environment variables.');
            }

            for (const key of Object.keys(files) as Array<FileType>) {
                const file = files[key];
                if (file) {
                    const page = key.startsWith('home') ? 'home' : 'about';
                    const device = key.endsWith('Mobile') ? 'mobile' : 'pc';
                    const filePath = `settings/hero-${page}-${device}/${file.name}`;
                    const storageRef = ref(storage, filePath);
                    const uploadTask = uploadBytesResumable(storageRef, file);
                    
                    await new Promise<void>((resolve, reject) => {
                        uploadTask.on('state_changed',
                            () => {}, // progress
                            (error) => reject(error),
                            () => resolve()
                        );
                    });
                    
                    const downloadUrl = getPublicUrl(bucketName, filePath);
                    if (!downloadUrl) {
                        throw new Error(`Failed to generate public URL for ${filePath}`);
                    }

                    if (!updatedSettings[page]) updatedSettings[page] = {};
                    const urlProp = device === 'pc' ? 'url' : 'urlMobile';
                    (updatedSettings[page]! as any)[urlProp] = downloadUrl;
                }
            }
            
            const docRef = doc(firestore, 'settings', 'heroImages');
            await setDoc(docRef, updatedSettings, { merge: true });
            
            toast({
                title: '저장 완료',
                description: '히어로 정보가 성공적으로 업데이트되었습니다.',
            });
            setFiles({});
        } catch (error) {
            console.error("Error saving hero images: ", error);
            const message = error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
             toast({
                variant: 'destructive',
                title: '저장 실패',
                description: `히어로 정보 저장 중 오류가 발생했습니다: ${message}`,
            });
        } finally {
            setIsSaving(false);
        }
    };
    
    if (isLoading) {
        return <CardContent className="space-y-6">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-60 w-full" />)}</CardContent>;
    }

    const renderManagerFor = (type: 'home' | 'about') => {
        const pcImageUrl = settings[type]?.url;
        const mobileImageUrl = settings[type]?.urlMobile;
      
        return (
          <div className="space-y-6 rounded-lg border p-4">
              <h4 className="font-semibold text-lg">{type === 'home' ? '홈페이지' : '아카데미 소개'} 히어로</h4>
              
              {/* Text Content */}
              <div className="space-y-2">
                  <Label>제목</Label>
                  <Input 
                      value={settings[type]?.title || ''}
                      onChange={e => handleTextChange(type, 'title', e.target.value)}
                      placeholder={`${type === 'home' ? '온라인 동영상 강의' : '뷰티 비즈니스...'}`}
                  />
              </div>
              <div className="space-y-2">
                  <Label>설명</Label>
                  <Textarea 
                      value={settings[type]?.description || ''}
                      onChange={e => handleTextChange(type, 'description', e.target.value)}
                      placeholder={`${type === 'home' ? '온라인에서 고품질 강의를 만나보세요' : '엘라인이 뷰티 전문가의 기준을...'}`}
                  />
              </div>
    
              <Separator />
    
              {/* PC Image */}
              <div className="space-y-2">
                  <Label>PC 배경 이미지</Label>
                  {pcImageUrl && <Image src={pcImageUrl} alt={`${type} hero preview`} width={500} height={200} className="rounded-md object-cover"/>}
                  <div className="flex items-center gap-2">
                    <Input type="file" onChange={e => handleFileChange(type, e.target.files?.[0] || null)} accept="image/*" className="flex-1" />
                    {files[type] && (
                      <Button variant="outline" size="sm" onClick={() => handleCancelFileChange(type)}>취소</Button>
                    )}
                  </div>
                </div>
              
              <Separator />
              
              {/* Mobile Image */}
              <div className="space-y-2">
                  <Label>모바일 배경 이미지</Label>
                  {mobileImageUrl && <Image src={mobileImageUrl} alt={`${type} mobile hero preview`} width={500} height={200} className="rounded-md object-cover"/>}
                  <div className="flex items-center gap-2">
                    <Input type="file" onChange={e => handleFileChange(`${type}Mobile`, e.target.files?.[0] || null)} accept="image/*" className="flex-1" />
                    {files[`${type}Mobile` as FileType] && (
                      <Button variant="outline" size="sm" onClick={() => handleCancelFileChange(`${type}Mobile` as FileType)}>취소</Button>
                    )}
                  </div>
                </div>
          </div>
      );
    }

    return (
        <CardContent className="space-y-6">
            {renderManagerFor('home')}
            {renderManagerFor('about')}
            <Button onClick={handleSave} disabled={isSaving}>{isSaving ? '저장 중...' : '히어로 정보 저장'}</Button>
        </CardContent>
    );
}

function FooterSettingsManager() {
  const firestore = useFirestore();
  const { toast } = useToast();
  const footerRef = useMemoFirebase(() => (firestore ? doc(firestore, 'settings', 'footer') : null), [firestore]);
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
      .catch((error) => {
        console.error(error);
        toast({ variant: 'destructive', title: '저장 실패', description: '푸터 정보 업데이트 중 오류가 발생했습니다.'});
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
  const policiesQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'policies') : null), [firestore]);
  const { data: policies, isLoading } = useCollection<Policy>(policiesQuery);
  
  const [localPolicies, setLocalPolicies] = useState<Record<string, Partial<Policy>>>({});
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (policies) {
      const policyMap = policies.reduce((acc, p) => {
        acc[p.slug] = p;
        return acc;
      }, {} as Record<string, Policy>);
      setLocalPolicies(policyMap);
    }
  }, [policies]);

  const handlePolicyChange = (slug: string, content: string) => {
    setLocalPolicies(prev => ({
      ...prev,
      [slug]: { ...prev[slug], content }
    }));
  };

  const handleSaveChanges = async () => {
    if (!firestore || Object.keys(localPolicies).length === 0) return;
    setIsSaving(true);
    try {
      for (const slug in localPolicies) {
        const policy = localPolicies[slug];
        if (policy && policy.content) {
            const docRef = doc(firestore, 'policies', slug);
            await updateDoc(docRef, { content: policy.content });
        }
      }
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
    return localPolicies[slug]?.content || '';
  }
  
  const getPolicyTitle = (slug: 'terms' | 'privacy' | 'refund') => {
    return localPolicies[slug]?.title || '로딩 중...';
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

      <Tabs defaultValue="general" className="mt-6">
        <TabsList>
          <TabsTrigger value="general">일반</TabsTrigger>
          <TabsTrigger value="footer">푸터</TabsTrigger>
          <TabsTrigger value="policies">약관 및 정책</TabsTrigger>
        </TabsList>
        <TabsContent value="general" className="mt-4">
            <Card>
                <CardHeader>
                  <CardTitle>히어로 섹션 관리</CardTitle>
                  <p className="text-sm text-muted-foreground">홈페이지 및 소개 페이지의 상단 이미지와 문구를 수정합니다.</p>
                </CardHeader>
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
                        <Switch disabled />
                    </div>
                    <Button disabled>저장</Button>
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
