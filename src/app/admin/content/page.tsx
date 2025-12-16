
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import HierarchyManager from "./hierarchy-manager";
import PricingManager from "./pricing-manager";
import VideoManager from "./video-manager";

export default function AdminContentPage() {
  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tight font-headline">콘텐츠 관리</h1>
      <p className="text-muted-foreground">분류, 가격, 비디오 등 모든 콘텐츠를 이곳에서 관리합니다.</p>

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
    </div>
  );
}
