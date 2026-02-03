'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import HierarchyManager from '@/components/admin/content/hierarchy-manager';
import PricingManager from '@/components/admin/content/pricing-manager';
import VideoManager from '@/components/admin/content/video-manager';
import InstructorManager from '@/components/admin/content/instructor-manager';


export default function ContentTabs() {
  return (
    <Tabs defaultValue="hierarchy" className="mt-6">
      <TabsList>
        <TabsTrigger value="hierarchy">콘텐츠 계층 관리</TabsTrigger>
        <TabsTrigger value="pricing">분류 가격 관리</TabsTrigger>
        <TabsTrigger value="instructor">강사 관리</TabsTrigger>
        <TabsTrigger value="videos">비디오 관리</TabsTrigger>
      </TabsList>
      <TabsContent value="hierarchy" className="mt-4">
          <HierarchyManager />
      </TabsContent>
      <TabsContent value="pricing" className="mt-4">
          <PricingManager />
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
