'use client';

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
  SheetClose,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useCart } from '@/context/cart-context';
import { CartItem } from './cart-item';
import { formatPrice } from '@/lib/utils';
import { Separator } from '../ui/separator';
import CartPaymentDialog from './cart-payment-dialog';

export default function CartSidebar() {
  const { isCartOpen, closeCart, items, totalAmount } = useCart();

  return (
    <Sheet open={isCartOpen} onOpenChange={closeCart}>
      <SheetContent className="flex w-full flex-col pr-0 sm:max-w-lg">
        <SheetHeader className="px-6">
          <SheetTitle>장바구니</SheetTitle>
        </SheetHeader>
        <Separator />

        {items.length > 0 ? (
          <>
            <ScrollArea className="flex-1 px-6">
              <div className="flex flex-col divide-y">
                {items.map((item) => (
                  <CartItem key={item.id} item={item} />
                ))}
              </div>
            </ScrollArea>
            <Separator />
            <SheetFooter className="px-6 py-4 bg-background">
                <div className="w-full space-y-4">
                    <div className="flex justify-between text-lg font-semibold">
                        <span>총 금액</span>
                        <span>{formatPrice(totalAmount)}</span>
                    </div>
                     <CartPaymentDialog>
                        <Button className="w-full" size="lg">결제하기</Button>
                     </CartPaymentDialog>
                </div>
            </SheetFooter>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
            <h3 className="text-xl font-semibold">장바구니가 비었습니다.</h3>
            <p className="text-muted-foreground">구독하고 싶은 이용권을 담아보세요!</p>
            <SheetClose asChild>
                <Button>이용권 보러가기</Button>
            </SheetClose>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
