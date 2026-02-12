'use client';

import ContentTabs from "@/components/admin/content/content-tabs";

export default function AdminContentPage() {
  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tight font-headline">콘텐츠 관리</h1>
      <p className="text-muted-foreground">분류, 가격, 비디오 등 모든 콘텐츠를 이곳에서 관리합니다.</p>
      <ContentTabs />
    </div>
  );
}
