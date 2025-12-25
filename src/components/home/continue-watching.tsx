
'use client';

import { useMemo } from 'react';
import { useUser, useFirestore, useCollection } from '@/firebase';
import { collection, query, orderBy, limit } from 'firebase/firestore';
import type { ViewHistoryItem, Course } from '@/lib/types';
import ContentCarousel from '@/components/shared/content-carousel';
import { Skeleton } from '@/components/ui/skeleton';

export default function ContinueWatching() {
    const { user } = useUser();
    const firestore = useFirestore();

    // TODO: Replace this mock data with actual Firestore data fetching
    const mockCourses: Course[] = [
        { id: 'course-001', classificationId: 'class-01', name: 'React 마스터 클래스', description: 'React의 모든 것을 마스터합니다.', thumbnailUrl: 'https://picsum.photos/seed/101/600/400' },
        { id: 'course-003', classificationId: 'class-03', name: '매일 30분 요가', description: '하루 30분으로 몸과 마음의 균형을 찾으세요.', thumbnailUrl: 'https://picsum.photos/seed/103/600/400' },
        { id: 'course-007', classificationId: 'class-05', name: '비즈니스 영어 회화', description: '실전 비즈니스 상황에서 자신있게 소통하는 법을 배웁니다.', thumbnailUrl: 'https://picsum.photos/seed/107/600/400' },
        { id: 'course-009', classificationId: 'class-01', name: 'Node.js 백엔드 개발', description: 'JavaScript로 확장 가능한 서버를 구축합니다.', thumbnailUrl: 'https://picsum.photos/seed/109/600/400' },
    ];
    
    // This is the implementation for when real data is available.
    /*
    const historyQuery = useMemo(() => {
        if (!user || !firestore) return null;
        return query(
            collection(firestore, 'users', user.id, 'viewHistory'),
            orderBy('lastWatched', 'desc'),
            limit(10)
        );
    }, [user, firestore]);

    const { data: historyItems, isLoading: historyLoading } = useCollection<ViewHistoryItem>(historyQuery);

    const coursesQuery = useMemo(() => {
        if (!firestore) return null;
        return collection(firestore, 'courses');
    }, [firestore]);
    
    const { data: allCourses, isLoading: coursesLoading } = useCollection<Course>(coursesQuery);

    const watchedCourses = useMemo(() => {
        if (!historyItems || !allCourses) return [];
        // Get unique course IDs from history
        const uniqueCourseIds = [...new Set(historyItems.map(item => item.courseId))];
        // Map course IDs to actual course objects
        return uniqueCourseIds.map(courseId => allCourses.find(c => c.id === courseId)).filter(Boolean) as Course[];
    }, [historyItems, allCourses]);

    const isLoading = historyLoading || coursesLoading;
    */

    // Using mock data for now
    const isLoading = false;
    const watchedCourses = mockCourses;

    if (isLoading) {
        return (
            <div className="space-y-4">
              <Skeleton className="h-8 w-1/4" />
              <div className="flex space-x-4">
                <Skeleton className="h-64 w-1/4" />
                <Skeleton className="h-64 w-1/4" />
                <Skeleton className="h-64 w-1/4" />
                <Skeleton className="h-64 w-1/4" />
              </div>
            </div>
        );
    }
    
    if (!watchedCourses || watchedCourses.length === 0) {
        return null;
    }

    return (
        <ContentCarousel title="최근 시청 영상" courses={watchedCourses} />
    );
}
