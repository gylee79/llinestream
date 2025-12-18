
'use client';
import PricingCard from '@/components/pricing/pricing-card';
import { useCollection, useFirestore, useUser } from '@/firebase';
import { collection, query, where } from 'firebase/firestore';
import type { Classification } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { useCart } from '@/context/cart-context';
import { formatPrice } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import CartPaymentDialog from '@/components/cart/cart-payment-dialog';
import { AnimatePresence, motion } from 'framer-motion';
import { useMemo } from 'react';

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
        className="fixed bottom-0 left-0 right-0 bg-background border-t shadow-[0_-4px_16px_rgba(0,0,0,0.1)] z-40"
      >
        <div className="container mx-auto p-4 flex items-center justify-between">
          <div className="flex-1">
            <h3 className="font-semibold text-lg">장바구니 요약</h3>
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
          <div className="flex items-center gap-6 pl-6">
            <div className="text-right">
              <span className="text-muted-foreground">총 금액</span>
              <p className="font-bold text-2xl">{formatPrice(totalAmount)}</p>
            </div>
            <CartPaymentDialog>
                <Button size="lg" disabled={!user}>
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
  const classificationsQuery = useMemo(() => 
    firestore ? query(collection(firestore, 'classifications'), where('prices.day30', '>', 0)) : null,
    [firestore]
  );
  const { data: subscribableClassifications, isLoading } = useCollection<Classification>(classificationsQuery);

  return (
    <>
      <div className="container mx-auto py-12 pb-48"> {/* Add padding-bottom to avoid overlap with summary */}
        <header className="mb-12 text-center">
          <h1 className="font-headline text-4xl font-bold tracking-tight">구독 안내</h1>
          <p className="mt-2 text-lg text-muted-foreground">
            관심 있는 분야를 구독하고 모든 콘텐츠를 무제한으로 즐겨보세요.
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
            subscribableClassifications?.map((classification) => (
              <PricingCard key={classification.id} classification={classification} />
            ))
          )}
        </div>
      </div>
      <CartSummary />
    </>
  );
}
