
'use client';

import { useState, useEffect } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import HierarchyManager from "@/components/admin/content/hierarchy-manager";
import CoursePricingManager from "@/components/admin/content/course-pricing-manager";
import VideoManager from "@/app/admin/content/video-manager";
import InstructorManager from "@/components/admin/content/instructor-manager";
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
    <Tabs defaultValue="hierarchy" className="mt-6">
      <TabsList>
        <TabsTrigger value="hierarchy">콘텐츠 계층 관리</TabsTrigger>
        <TabsTrigger value="pricing">상세분류 가격 관리</TabsTrigger>
        <TabsTrigger value="instructor">강사 관리</TabsTrigger>
        <TabsTrigger value="videos">비디오 관리</TabsTrigger>
      </TabsList>
      <TabsContent value="hierarchy" className="mt-4">
        <HierarchyManager />
      </TabsContent>
      <TabsContent value="pricing" className="mt-4">
        <CoursePricingManager />
      </TabsContent>
      <TabsContent value="instructor" className="mt-4">
        <InstructorManager />
      </TabsContent>
      <TabsContent value="videos" className="mt-4">
        <VideoManager />
      </TabsContent>
    </Tabs>
  );
}
