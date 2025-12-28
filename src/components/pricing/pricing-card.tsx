
'use client';

import { useState } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import type { Course, Classification } from '@/lib/types';
import { useCart, type CartItem } from '@/context/cart-context';
import { formatPrice } from '@/lib/utils';
import { ShoppingCart } from 'lucide-react';
import { cn } from '@/lib/utils';

type ItemWithPrice = Course; // Or union type if needed e.g. Course | Classification

interface PricingCardProps {
  item: ItemWithPrice;
  itemType: 'course';
}

export default function PricingCard({ item, itemType }: PricingCardProps) {
  const [selectedDuration, setSelectedDuration] = useState<keyof ItemWithPrice['prices']>('day30');
  const { addToCart, items } = useCart();
  
  const plans = [
    { duration: 'day1', label: '1일 이용권', price: item.prices.day1 },
    { duration: 'day30', label: '30일 이용권', price: item.prices.day30 },
    { duration: 'day60', label: '60일 이용권', price: item.prices.day60 },
    { duration: 'day90', label: '90일 이용권', price: item.prices.day90 },
  ].filter(plan => plan.price > 0);

  const selectedPrice = item.prices[selectedDuration] || 0;
  
  const durationLabels: { [key in keyof ItemWithPrice['prices']]: string } = {
    day1: '1일',
    day30: '30일',
    day60: '60일',
    day90: '90일',
  };
  const selectedLabelForDisplay = durationLabels[selectedDuration];
  const currentCartItemId = `${item.id}-${selectedDuration}`;
  const isInCart = items.some(cartItem => cartItem.id === currentCartItemId);

  const handleAddToCart = () => {
    const selectedPlan = plans.find(p => p.duration === selectedDuration);
    if (!selectedPlan || isInCart) {
        return;
    }

    const itemToAdd: CartItem = {
      id: `${item.id}-${selectedDuration}`,
      itemId: item.id,
      itemType: itemType,
      name: item.name,
      price: selectedPlan.price,
      quantity: 1, // Quantity is always 1 for subscriptions
      duration: selectedDuration,
      durationLabel: selectedPlan.label,
      thumbnailUrl: item.thumbnailUrl || `https://picsum.photos/seed/${item.id}/100/100`
    };

    addToCart(itemToAdd);
  };

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle className="font-headline text-2xl">{item.name}</CardTitle>
        <CardDescription>{item.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex-grow">
        <div className="text-4xl font-bold">
          {formatPrice(selectedPrice)}
          <span className="ml-1 text-base font-normal text-muted-foreground">/ {selectedLabelForDisplay}</span>
        </div>
        <RadioGroup 
          defaultValue="day30" 
          className="mt-6 space-y-3"
          onValueChange={(value) => setSelectedDuration(value as keyof ItemWithPrice['prices'])}
        >
          {plans.map((plan) => {
             const cartItemId = `${item.id}-${plan.duration}`;
             const isCurrentInCart = items.some(item => item.id === cartItemId);
            return (
              <Label 
                key={plan.duration} 
                htmlFor={`${item.id}-${plan.duration}`} 
                className={cn(
                    "flex items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary cursor-pointer",
                    isCurrentInCart && "border-primary/50 bg-muted/50 cursor-not-allowed opacity-70"
                )}
              >
                <RadioGroupItem value={plan.duration} id={`${item.id}-${plan.duration}`} className="sr-only" disabled={isCurrentInCart} />
                <span>{plan.label}</span>
                <span className="font-bold text-foreground">{formatPrice(plan.price)}</span>
              </Label>
            )
          })}
        </RadioGroup>
      </CardContent>
      <CardFooter>
        <Button className="w-full" onClick={handleAddToCart} disabled={isInCart}>
            <ShoppingCart className="mr-2 h-4 w-4" />
            {isInCart ? '장바구니에 담김' : '장바구니에 담기'}
        </Button>
      </CardFooter>
    </Card>
  );
}
