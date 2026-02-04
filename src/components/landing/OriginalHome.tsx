'use client';
import { useCollection, useFirestore, useUser, useMemoFirebase } from '@/firebase/hooks';
import { collection, query, orderBy } from 'firebase/firestore';
import { Course, Classification, Episode, Field, EpisodeViewLog, Instructor, User } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Image from 'next/image';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { BookUser, Search, BookOpen, ImageIcon, ChevronDown, ChevronUp, Bookmark, Download, ChevronRight } from 'lucide-react';
import ContentCarousel from '@/components/shared/content-carousel';
import { motion, AnimatePresence, useMotionValue, animate, useTransform } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import LandingPageSwitch from '../layout/LandingPageSwitch';

const CollapsibleUserPanel = ({ user, isMobile }: { user: User, isMobile: boolean }) => {
    const [isOpen, setIsOpen] = useState(false);
    const contentWrapperRef = useRef<HTMLDivElement>(null);
    const height = useMotionValue(0);
    const dragStartHeight = useRef(0);

    const setPanelState = useCallback((open: boolean) => {
        const contentHeight = contentWrapperRef.current?.scrollHeight || 0;
        const newHeight = open ? contentHeight : 0;
        
        animate(height, newHeight, {
            type: "spring",
            stiffness: 300,
            damping: 35
        });
        setIsOpen(open);
    }, [height]);

    const handleDragStart = () => {
        dragStartHeight.current = height.get();
    };
    
    const handleDrag = (event: MouseEvent | TouchEvent | PointerEvent, info: any) => {
        const contentHeight = contentWrapperRef.current?.scrollHeight || 0;
        if (!contentHeight) return;
        
        const newHeight = dragStartHeight.current + info.offset.y;
        height.set(Math.max(0, Math.min(newHeight, contentHeight)));
    };

    const handleDragEnd = (event: MouseEvent | TouchEvent | PointerEvent, info: any) => {
        const contentHeight = contentWrapperRef.current?.scrollHeight || 0;
        if (!contentHeight) return;

        const currentHeight = height.get();
        const velocity = info.velocity.y;

        if (velocity > 500 || currentHeight > contentHeight / 2) {
            setPanelState(true);
        } else {
            setPanelState(false);
        }
    };
    
    useEffect(() => {
        if (isOpen) {
            const contentHeight = contentWrapperRef.current?.scrollHeight || 0;
            animate(height, contentHeight, { type: 'spring', stiffness: 300, damping: 35 });
        }
    }, [isOpen, height]);

    const rotate = useTransform(height, [0, 100], [0, 180]);


    return (
        <div className="rounded-xl bg-gradient-to-br from-primary to-foreground text-primary-foreground">
            <div className="px-4">
                <div
                    className="relative"
                    style={{ minHeight: '3rem' }}
                >
                     <AnimatePresence initial={false}>
                        {isOpen ? (
                            <motion.div
                                key="open"
                                className="absolute inset-0 flex w-full items-center"
                                initial={{ opacity: 0, y: -10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: 10 }}
                                transition={{ duration: 0.3, ease: 'easeInOut' }}
                            >
                                <h2 className="font-bold text-lg">{user.name}님, 환영합니다!</h2>
                            </motion.div>
                        ) : (
                            <motion.div
                                key="closed"
                                className={cn(
                                    "absolute inset-0 flex w-full justify-between items-end",
                                    isMobile && "pb-2"
                                )}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -10 }}
                                transition={{ duration: 0.3, ease: 'easeInOut' }}
                            >
                                <p className="font-bold">{user.name}님</p>
                                <div className={cn("flex items-center text-sm", isMobile ? 'gap-1' : 'gap-3')}>
                                    <Link href="/my-courses" onClick={(e) => e.stopPropagation()} className="hover:opacity-80 transition-opacity">나의 강의실</Link>
                                    <span className="opacity-50">·</span>
                                    <Link href="/my-bookmarks" onClick={(e) => e.stopPropagation()} className="hover:opacity-80 transition-opacity">책 갈피</Link>
                                    <span className="opacity-50">·</span>
                                    <Link href="/downloads" onClick={(e) => e.stopPropagation()} className="hover:opacity-80 transition-opacity">다운로드함</Link>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                <motion.div
                    className="overflow-hidden"
                    style={{ height }}
                >
                    <div ref={contentWrapperRef} className="pb-4">
                      <div className="p-4 bg-primary-foreground/20 rounded-lg flex justify-around">
                          <Link href="/my-courses" className="flex flex-col items-center gap-2 text-sm font-medium hover:text-primary-foreground/80 transition-colors">
                              <div className="h-12 w-12 rounded-full bg-primary-foreground/20 flex items-center justify-center">
                                  <BookUser className="h-6 w-6" />
                              </div>
                              <span>나의 강의실</span>
                          </Link>
                          <Link href="/my-bookmarks" className="flex flex-col items-center gap-2 text-sm font-medium hover:text-primary-foreground/80 transition-colors">
                              <div className="h-12 w-12 rounded-full bg-primary-foreground/20 flex items-center justify-center">
                                  <Bookmark className="h-6 w-6" />
                              </div>
                              <span>책 갈피</span>
                          </Link>
                          <Link href="/downloads" className="flex flex-col items-center gap-2 text-sm font-medium hover:text-primary-foreground/80 transition-colors">
                              <div className="h-12 w-12 rounded-full bg-primary-foreground/20 flex items-center justify-center">
                                  <Download className="h-6 w-6" />
                              </div>
                              <span>다운로드함</span>
                          </Link>
                      </div>
                    </div>
                </motion.div>
            </div>

            {/* Handle Area */}
            <motion.div
                className="w-full flex justify-center cursor-grab"
                drag="y"
                dragConstraints={{ top: 0, bottom: 0 }}
                dragElastic={{ top: 0, bottom: 0.5 }}
                onDragStart={handleDragStart}
                onDrag={handleDrag}
                onDragEnd={handleDragEnd}
                onTap={() => setPanelState(!isOpen)}
                style={{ touchAction: 'none' }} // Prevents page scroll on mobile
            >
                 <motion.div
                    className="h-6 w-6"
                    style={{ rotate }}
                 >
                    <ChevronDown className="h-full w-full opacity-70" />
                </motion.div>
            </motion.div>
        </div>
    );
};


export default function OriginalHome() {
  const firestore = useFirestore();
  const { user } = useUser();
  const isMobile = useIsMobile();

  const fieldsQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'fields'), orderBy('orderIndex')) : null), [firestore]);
  const { data: sortedFields, isLoading: fieldsLoading } = useCollection<Field>(fieldsQuery);
  
  const classificationsQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'classifications') : null), [firestore]);
  const { data: classifications, isLoading: classificationsLoading } = useCollection<Classification>(classificationsQuery);

  const viewLogsQuery = useMemoFirebase(() => {
      if (!user || !firestore) return null;
      return query(
          collection(firestore, 'users', user.id, 'viewHistory'),
          orderBy('endedAt', 'desc')
      );
  }, [user, firestore]);
  const { data: viewLogs, isLoading: historyLoading } = useCollection<EpisodeViewLog>(viewLogsQuery);

  const episodesQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'episodes') : null), [firestore]);
  const { data: allEpisodes, isLoading: episodesLoading } = useCollection<Episode>(episodesQuery);

  const watchedEpisodes = useMemo(() => {
      if (!viewLogs || !allEpisodes) return [];
      const episodeMap = new Map(allEpisodes.map(e => [e.id, e]));
      const validLogs = viewLogs.filter(log => log.duration >= 5);
      const uniqueEpisodeIds = [...new Set(validLogs.map(log => log.episodeId))];
      return uniqueEpisodeIds.map(episodeId => episodeMap.get(episodeId)).filter(Boolean) as Episode[];
  }, [viewLogs, allEpisodes]);

  const classificationsByField = useMemo(() => {
    if (!classifications) {
      return new Map<string, string[]>();
    }
    const grouped = new Map<string, Classification[]>();
    classifications.forEach(classification => {
        const items = grouped.get(classification.fieldId) || [];
        items.push(classification);
        grouped.set(classification.fieldId, items);
    });

    // Sort classifications within each group by orderIndex
    for (const group of grouped.values()) {
        group.sort((a, b) => (a.orderIndex ?? 999) - (b.orderIndex ?? 999));
    }

    const result = new Map<string, string[]>();
    grouped.forEach((value, key) => {
        result.set(key, value.map(c => c.name));
    });

    return result;
  }, [classifications]);


  const isLoading = fieldsLoading || classificationsLoading || (user && (historyLoading || episodesLoading));
  
  if (isLoading) {
      return (
          <div className="container space-y-8 pb-8">
            <Skeleton className="h-40 w-full rounded-lg" />
            <Skeleton className="h-8 w-1/3" />
            <div className="space-y-2">
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
            </div>
            <Skeleton className="h-64 w-full" />
          </div>
      )
  }

  return (
    <div className="flex-1 bg-muted/50">
      <div className="container space-y-6 pb-6 md:pb-8">
        
        {user ? (
            <CollapsibleUserPanel user={user} isMobile={isMobile} />
        ) : (
            <section className="rounded-xl bg-primary/10 shadow-sm p-6 md:p-8 text-center">
                 <h1 className="text-xl md:text-2xl font-bold">LlineStream에 오신 것을 환영합니다!</h1>
                 <p className="text-muted-foreground mt-2">로그인하고 맞춤형 학습 경험을 시작해보세요.</p>
                 <Button asChild className="mt-6">
                     <Link href="/login">로그인 / 회원가입</Link>
                 </Button>
            </section>
        )}

        {user && watchedEpisodes.length > 0 && (
          <ContentCarousel
            title="최근 학습 기록"
            items={watchedEpisodes}
            itemType="episode"
          />
        )}
        
        <section>
          <h2 className="font-body text-xl font-bold tracking-tight mb-4">
            분야별 강좌 <span className="text-lg text-muted-foreground">({sortedFields?.length || 0})</span>
          </h2>
          <Card>
            <CardContent className="p-0">
              <div>
                {sortedFields?.map((field) => {
                  const fieldClassifications = classificationsByField.get(field.id) || [];
                  return (
                    <Link href={`/fields/${field.id}`} key={field.id} className="block group hover:bg-muted/50 transition-colors">
                      <div className="flex items-center gap-4 p-4 border-b last:border-b-0">
                        <Avatar className="h-11 w-11 border">
                          {field.thumbnailUrl ? (
                              <AvatarImage src={field.thumbnailUrl} alt={field.name} className="object-cover" />
                          ) : (
                              <AvatarFallback>
                                <ImageIcon className="h-5 w-5 text-muted-foreground" />
                              </AvatarFallback>
                          )}
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-base leading-tight truncate group-hover:text-primary transition-colors">{field.name}</p>
                          <p className="text-sm text-muted-foreground mt-1 truncate">
                            {fieldClassifications.join(' · ')}
                          </p>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </section>

      </div>
    </div>
  );
}
