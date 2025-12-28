
'use client';
import PricingCard from '@/components/pricing/pricing-card';
import { useCollection, useFirestore, useUser, useMemoFirebase } from '@/firebase/hooks';
import { collection, query, where } from 'firebase/firestore';
import type { Course } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { useCart } from '@/context/cart-context';
import { formatPrice } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import CartPaymentDialog from '@/components/cart/cart-payment-dialog';
import { AnimatePresence, motion } from 'framer-motion';
import { Separator } from '@/components/ui/separator';

function CartSummary() {
  const { items, totalAmount, removeFromCart } = useCart();
  const { user } = useUser();

  if (items.length === 0) {
    return null;
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 100 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 100 }}
        transition={{ duration: 0.3 }}
        className="fixed bottom-0 left-0 right-0 bg-background border-t shadow-[0_-4px_16px_rgba(0,0,0,0.1)] z-50"
      >
        <div className="container mx-auto p-4 flex flex-col md:flex-row items-center justify-between gap-4">
          {/* --- Selected Items --- */}
          <div className="w-full flex-1 overflow-hidden">
            <h3 className="font-semibold text-lg hidden md:block">장바구니 요약</h3>
            <div className="flex gap-4 mt-2 overflow-x-auto pb-2">
              {items.map(item => (
                <div key={item.id} className="bg-muted p-2 rounded-md flex items-center gap-2 text-sm whitespace-nowrap">
                  <span>{item.name} ({item.durationLabel})</span>
                  <span className="font-semibold">{formatPrice(item.price)}</span>
                  <button onClick={() => removeFromCart(item.id)} className="text-muted-foreground hover:text-destructive">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
          
          <Separator className="w-full md:hidden" />

          {/* --- Total & Payment Button --- */}
          <div className="w-full md:w-auto flex items-center justify-between md:justify-end md:gap-6">
            <div className="text-left md:text-right">
              <span className="text-muted-foreground text-sm">총 금액</span>
              <p className="font-bold text-lg md:text-2xl whitespace-nowrap">{formatPrice(totalAmount)}</p>
            </div>
            <CartPaymentDialog>
                <Button size="lg" disabled={!user} className="whitespace-nowrap ml-4">
                    {user ? "결제하기" : "로그인 후 결제"}
                </Button>
            </CartPaymentDialog>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}


export default function PricingPage() {
  const firestore = useFirestore();
  const coursesQuery = useMemoFirebase(() => 
    firestore ? query(collection(firestore, 'courses'), where('prices.day30', '>', 0)) : null,
    [firestore]
  );
  const { data: subscribableCourses, isLoading } = useCollection<Course>(coursesQuery);

  return (
    <>
      <div className="container mx-auto py-12 pb-48"> {/* Add padding-bottom to avoid overlap with summary */}
        <header className="mb-12 text-center">
          <h1 className="font-headline text-4xl font-bold tracking-tight">수강권 구매</h1>
          <p className="mt-2 text-lg text-muted-foreground">
            관심 있는 강좌를 구매하고 모든 에피소드를 무제한으로 즐겨보세요.
          </p>
        </header>
        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
          {isLoading ? (
            <>
              <Skeleton className="h-96 w-full" />
              <Skeleton className="h-96 w-full" />
              <Skeleton className="h-96 w-full" />
            </>
          ) : (
            subscribableCourses?.map((course) => (
              <PricingCard key={course.id} item={course} itemType="course" />
            ))
          )}
        </div>
      </div>
      <CartSummary />
    </>
  );
}
