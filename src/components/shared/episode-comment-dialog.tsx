'use client';

import { useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import * as z from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
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
import { Separator } from '../ui/separator';
import { Card, CardContent } from '../ui/card';

const commentSchema = z.object({
  content: z.string().min(1, '내용을 입력해주세요.').max(1000, '1000자 이내로 작성해주세요.'),
  rating: z.number().min(0).max(5).optional(),
});

interface EpisodeCommentDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  episode?: Episode;
  comments?: EpisodeComment[];
  user: User;
  mode?: 'comment' | 'view';
}

const CommentList = ({ comments }: { comments: EpisodeComment[] | null | undefined }) => (
    <div className="flex gap-4">
        {comments?.map((comment) => (
          <Card key={comment.id} className="w-80 flex-shrink-0">
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
)

export default function EpisodeCommentDialog({
  isOpen,
  onOpenChange,
  episode,
  comments: propComments,
  user,
  mode = 'comment',
}: EpisodeCommentDialogProps) {
  const firestore = useFirestore();
  const { toast } = useToast();
  const [hoverRating, setHoverRating] = useState(0);

  const commentsQuery = useMemoFirebase(
    () =>
      firestore && episode && mode === 'comment'
        ? query(
            collection(firestore, 'episodes', episode.id, 'comments'),
            orderBy('createdAt', 'desc')
          )
        : null,
    [firestore, episode, mode]
  );
  const { data: dbComments, isLoading } = useCollection<EpisodeComment>(commentsQuery);

  const comments = mode === 'view' ? propComments : dbComments;

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
    if (!firestore || !episode) return;
    try {
      await addDoc(collection(firestore, 'episodes', episode.id, 'comments'), {
        episodeId: episode.id,
        userId: user.id,
        userName: user.name,
        userRole: user.role,
        content: data.content,
        rating: data.rating || undefined,
        createdAt: serverTimestamp(),
      });
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
  
  const dialogTitle = mode === 'view' ? '전체 리뷰' : '리뷰 및 질문';
  const dialogDescription = mode === 'view' ? '모든 리뷰를 확인합니다.' : episode?.title;


  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogDescription>{dialogDescription}</DialogDescription>
        </DialogHeader>

        <div className={cn("max-h-[60vh]", mode === 'comment' && "grid grid-cols-1 md:grid-cols-2 gap-6")}>
          {/* Comment List */}
          <div className="flex flex-col">
            <h3 className="text-lg font-semibold mb-2">
              <MessageSquare className="inline-block w-5 h-5 mr-2" />
              모든 댓글 ({comments?.length || 0})
            </h3>
            <div className="flex-grow border rounded-md p-4 bg-muted/50 overflow-x-auto">
              {isLoading && <p>댓글을 불러오는 중...</p>}
              {!isLoading && comments?.length === 0 && (
                <p className="text-center text-muted-foreground py-8">
                  아직 댓글이 없습니다.
                </p>
              )}
              <CommentList comments={comments} />
            </div>
          </div>

          {/* Comment Form - shown only in 'comment' mode */}
          {mode === 'comment' && (
            <div className="flex flex-col">
              <h3 className="text-lg font-semibold mb-2">댓글 작성하기</h3>
              <form
                onSubmit={handleSubmit(onSubmit)}
                className="flex-grow flex flex-col space-y-4 border rounded-md p-4"
              >
                <div className="space-y-1">
                  <label className="text-sm font-medium">별점 (선택)</label>
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
                            onClick={() => field.onChange(star === ratingValue ? 0 : star)}
                          />
                        ))}
                      </div>
                    )}
                  />
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
                <DialogFooter>
                  <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? '등록 중...' : '댓글 등록'}
                  </Button>
                </DialogFooter>
              </form>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
