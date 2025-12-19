
'use client';

import { useState, useEffect } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import HierarchyManager from "@/app/admin/content/hierarchy-manager";
import PricingManager from "@/app/admin/content/pricing-manager";
import VideoManager from "@/app/admin/content/video-manager";
import { Skeleton } from '@/components/ui/skeleton';

export default function ContentTabs() {
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  if (!isClient) {
    return (
        <div className="mt-6">
            <Skeleton className="h-10 w-96" />
            <Skeleton className="mt-4 h-64 w-full" />
        </div>
    );
  }

  return (
    <Tabs defaultValue="videos" className="mt-6">
      <TabsList>
        <TabsTrigger value="hierarchy">콘텐츠 계층 관리</TabsTrigger>
        <TabsTrigger value="pricing">분류 및 가격 관리</TabsTrigger>
        <TabsTrigger value="videos">비디오 관리</TabsTrigger>
      </TabsList>
      <TabsContent value="hierarchy" className="mt-4">
        <HierarchyManager />
      </TabsContent>
      <TabsContent value="pricing" className="mt-4">
        <PricingManager />
      </TabsContent>
      <TabsContent value="videos" className="mt-4">
        <VideoManager />
      </TabsContent>
    </Tabs>
  );
}
