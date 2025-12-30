
'use client';

import { useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import * as z from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Star, MessageSquare } from 'lucide-react';
import {
  useCollection,
  useFirestore,
  useMemoFirebase,
} from '@/firebase/hooks';
import {
  collection,
  query,
  orderBy,
  addDoc,
  serverTimestamp,
} from 'firebase/firestore';
import type { Episode, User, EpisodeComment } from '@/lib/types';
import { toDisplayDate } from '@/lib/date-helpers';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';

const commentSchema = z.object({
  content: z.string().min(1, '내용을 입력해주세요.').max(1000, '1000자 이내로 작성해주세요.'),
  rating: z.number().min(1, '별점을 선택해주세요.').max(5),
});

interface EpisodeCommentSectionProps {
  episode: Episode;
  user: User;
}

export default function EpisodeCommentSection({
  episode,
  user,
}: EpisodeCommentSectionProps) {
  const firestore = useFirestore();
  const { toast } = useToast();
  const [hoverRating, setHoverRating] = useState(0);

  const commentsQuery = useMemoFirebase(
    () =>
      firestore
        ? query(
            collection(firestore, 'episodes', episode.id, 'comments'),
            orderBy('createdAt', 'desc')
          )
        : null,
    [firestore, episode.id]
  );
  const { data: comments, isLoading } =
    useCollection<EpisodeComment>(commentsQuery);

  const {
    register,
    handleSubmit,
    control,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(commentSchema),
    defaultValues: {
      content: '',
      rating: 0,
    },
  });

  const ratingValue = watch('rating');

  const onSubmit = async (data: z.infer<typeof commentSchema>) => {
    if (!firestore) return;
    try {
      const commentData = {
        episodeId: episode.id,
        userId: user.id,
        userName: user.name,
        userRole: user.role,
        content: data.content,
        rating: data.rating,
        createdAt: serverTimestamp(),
      };

      await addDoc(collection(firestore, 'episodes', episode.id, 'comments'), commentData);
      toast({ title: '성공', description: '댓글이 등록되었습니다.' });
      reset();
    } catch (error) {
      console.error(error);
      toast({
        variant: 'destructive',
        title: '오류',
        description: '댓글 등록에 실패했습니다.',
      });
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Comment List */}
        <div className="flex flex-col">
        <h3 className="text-lg font-semibold mb-2">
            <MessageSquare className="inline-block w-5 h-5 mr-2" />
            모든 댓글 ({comments?.length || 0})
        </h3>
        <ScrollArea className="flex-grow border rounded-md p-4 bg-muted/50 h-96">
            {isLoading && <p>댓글을 불러오는 중...</p>}
            {!isLoading && comments?.length === 0 && (
            <p className="text-center text-muted-foreground py-8">
                아직 댓글이 없습니다.
            </p>
            )}
            <div className="flex flex-col gap-4">
            {comments?.map((comment) => (
                <Card key={comment.id}>
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <Avatar className="h-8 w-8">
                        <AvatarFallback>
                          {comment.userName.charAt(0)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm">
                            {comment.userName}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {toDisplayDate(comment.createdAt)}
                          </span>
                        </div>
                        {comment.rating && comment.rating > 0 && (
                          <div className="flex items-center mt-1">
                            {[1, 2, 3, 4, 5].map((star) => (
                              <Star
                                key={star}
                                className={cn(
                                  'w-3 h-3',
                                  star <= comment.rating!
                                    ? 'text-yellow-400 fill-yellow-400'
                                    : 'text-muted-foreground'
                                )}
                              />
                            ))}
                          </div>
                        )}
                        <p className="text-sm mt-1 whitespace-pre-wrap break-words">
                          {comment.content}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
            ))}
            </div>
        </ScrollArea>
        </div>

        {/* Comment Form */}
        <div className="flex flex-col">
        <h3 className="text-lg font-semibold mb-2">댓글 작성하기</h3>
        <form
            onSubmit={handleSubmit(onSubmit)}
            className="flex-grow flex flex-col space-y-4 border rounded-md p-4"
        >
            <div className="space-y-1">
            <label className="text-sm font-medium">별점</label>
            <Controller
                name="rating"
                control={control}
                render={({ field }) => (
                <div className="flex items-center">
                    {[1, 2, 3, 4, 5].map((star) => (
                    <Star
                        key={star}
                        className={cn(
                        'w-6 h-6 cursor-pointer',
                        star <= (hoverRating || ratingValue || 0)
                            ? 'text-yellow-400 fill-yellow-400'
                            : 'text-muted-foreground'
                        )}
                        onMouseEnter={() => setHoverRating(star)}
                        onMouseLeave={() => setHoverRating(0)}
                        onClick={() => field.onChange(star)}
                    />
                    ))}
                </div>
                )}
            />
             {errors.rating && (
                <p className="text-xs text-destructive mt-1">
                    {errors.rating.message}
                </p>
            )}
            </div>

            <div className="flex-grow flex flex-col">
            <label htmlFor="content" className="text-sm font-medium">내용</label>
            <Textarea
                id="content"
                {...register('content')}
                placeholder="리뷰, 질문, 응원의 메시지를 남겨주세요."
                className="flex-grow resize-none"
            />
            {errors.content && (
                <p className="text-xs text-destructive mt-1">
                {errors.content.message}
                </p>
            )}
            </div>
            <div className="flex justify-end">
                <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? '등록 중...' : '댓글 등록'}
                </Button>
            </div>
        </form>
        </div>
    </div>
  );
}
