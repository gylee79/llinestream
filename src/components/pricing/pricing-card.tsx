
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
import type { Classification } from '@/lib/types';
import { useCart, type CartItem } from '@/context/cart-context';
import { useToast } from '@/hooks/use-toast';
import { formatPrice } from '@/lib/utils';
import { ShoppingCart } from 'lucide-react';

interface PricingCardProps {
  classification: Classification;
}

export default function PricingCard({ classification }: PricingCardProps) {
  const [selectedDuration, setSelectedDuration] = useState<keyof Classification['prices']>('day30');
  const { toast } = useToast();
  const { addToCart } = useCart();
  
  const plans = [
    { duration: 'day1', label: '1일 이용권', price: classification.prices.day1 },
    { duration: 'day30', label: '30일 이용권', price: classification.prices.day30 },
    { duration: 'day60', label: '60일 이용권', price: classification.prices.day60 },
    { duration: 'day90', label: '90일 이용권', price: classification.prices.day90 },
  ].filter(plan => plan.price > 0);

  const selectedPrice = classification.prices[selectedDuration] || 0;
  
  const durationLabels: { [key in keyof Classification['prices']]: string } = {
    day1: '1일',
    day30: '30일',
    day60: '60일',
    day90: '90일',
  };
  const selectedLabelForDisplay = durationLabels[selectedDuration];

  const handleAddToCart = () => {
    const selectedPlan = plans.find(p => p.duration === selectedDuration);
    if (!selectedPlan) return;

    const itemToAdd: CartItem = {
      id: `${classification.id}-${selectedDuration}`,
      classificationId: classification.id,
      name: classification.name,
      price: selectedPlan.price,
      quantity: 1,
      duration: selectedDuration,
      durationLabel: selectedPlan.label,
      thumbnailUrl: `https://picsum.photos/seed/${classification.id}/100/100` // Placeholder thumbnail
    };

    addToCart(itemToAdd);
    toast({
      title: '장바구니 추가',
      description: `"${classification.name} ${selectedPlan.label}" 상품이 장바구니에 담겼습니다.`,
    });
  };

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle className="font-headline text-2xl">{classification.name}</CardTitle>
        <CardDescription>{classification.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex-grow">
        <div className="text-4xl font-bold">
          {formatPrice(selectedPrice)}
          <span className="ml-1 text-base font-normal text-muted-foreground">/ {selectedLabelForDisplay}</span>
        </div>
        <RadioGroup 
          defaultValue="day30" 
          className="mt-6 space-y-3"
          onValueChange={(value) => setSelectedDuration(value as keyof Classification['prices'])}
        >
          {plans.map((plan) => (
            <Label key={plan.duration} htmlFor={`${classification.id}-${plan.duration}`} className="flex items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary cursor-pointer">
              <RadioGroupItem value={plan.duration} id={`${classification.id}-${plan.duration}`} className="sr-only" />
              <span>{plan.label}</span>
              <span className="font-bold text-foreground">{formatPrice(plan.price)}</span>
            </Label>
          ))}
        </RadioGroup>
      </CardContent>
      <CardFooter>
        <Button className="w-full" onClick={handleAddToCart}>
            <ShoppingCart className="mr-2 h-4 w-4" />
            장바구니에 담기
        </Button>
      </CardFooter>
    </Card>
  );
}
