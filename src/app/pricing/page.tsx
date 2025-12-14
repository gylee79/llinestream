import PricingCard from '@/components/pricing/pricing-card';
import { classifications } from '@/lib/data';

export default function PricingPage() {
  const subscribableClassifications = classifications.filter(c => c.prices.day30 > 0);

  return (
    <div className="container mx-auto py-12">
      <header className="mb-12 text-center">
        <h1 className="font-headline text-4xl font-bold tracking-tight">요금제 안내</h1>
        <p className="mt-2 text-lg text-muted-foreground">
          관심 있는 분야를 구독하고 모든 콘텐츠를 무제한으로 즐겨보세요.
        </p>
      </header>
      <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
        {subscribableClassifications.map((classification) => (
          <PricingCard key={classification.id} classification={classification} />
        ))}
      </div>
    </div>
  );
}
