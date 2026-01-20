'use client';

import dynamic from 'next/dynamic';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from '@/components/ui/skeleton';

const TabSkeleton = () => (
    <div className="mt-4">
        <Skeleton className="h-[70vh] w-full" />
    </div>
);

const HierarchyManager = dynamic(() => import('@/components/admin/content/hierarchy-manager'), { 
    loading: () => <TabSkeleton />,
});
const PricingManager = dynamic(() => import('@/components/admin/content/pricing-manager'), { 
    loading: () => <TabSkeleton />,
});
const VideoManager = dynamic(() => import('@/components/admin/content/video-manager'), {
    loading: () => <TabSkeleton />,
});
const InstructorManager = dynamic(() => import('@/components/admin/content/instructor-manager'), { 
    loading: () => <TabSkeleton />,
});


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
