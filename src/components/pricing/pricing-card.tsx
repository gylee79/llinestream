import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import type { Classification } from '@/lib/types';
import PaymentDialog from '../shared/payment-dialog';

interface PricingCardProps {
  classification: Classification;
}

export default function PricingCard({ classification }: PricingCardProps) {
  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('ko-KR').format(price);
  };

  const otherPlans = [
    { duration: '60일 이용권', price: classification.prices.day60 },
    { duration: '90일 이용권', price: classification.prices.day90 },
    { duration: '1일 이용권', price: classification.prices.day1 },
  ];

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle className="font-headline text-2xl">{classification.name}</CardTitle>
        <CardDescription>{classification.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex-grow">
        <div className="text-4xl font-bold">
          ₩{formatPrice(classification.prices.day30)}
          <span className="ml-1 text-base font-normal text-muted-foreground">/ 30일</span>
        </div>
        <Accordion type="single" collapsible className="w-full mt-4">
          <AccordionItem value="item-1">
            <AccordionTrigger>다른 기간 확인하기</AccordionTrigger>
            <AccordionContent>
              <ul className="space-y-2 text-sm text-muted-foreground">
                {otherPlans.map((plan) => (
                  <li key={plan.duration} className="flex justify-between">
                    <span>{plan.duration}</span>
                    <span className="font-medium text-foreground">₩{formatPrice(plan.price)}</span>
                  </li>
                ))}
              </ul>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </CardContent>
      <CardFooter>
        <PaymentDialog classification={classification}>
            <Button className="w-full">지금 구독하기</Button>
        </PaymentDialog>
      </CardFooter>
    </Card>
  );
}
