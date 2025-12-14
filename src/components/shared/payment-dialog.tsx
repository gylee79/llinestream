'use client'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose
} from "@/components/ui/dialog"
import { Button } from "../ui/button"
import type { Classification } from "@/lib/types"
import { useToast } from "@/hooks/use-toast"

interface PaymentDialogProps {
    children: React.ReactNode
    classification: Classification
}

export default function PaymentDialog({ children, classification }: PaymentDialogProps) {
    const { toast } = useToast();

    const handlePayment = () => {
        // Mock payment logic
        console.log(`Processing payment for ${classification.name}...`);
        setTimeout(() => {
            toast({
                title: "결제 성공",
                description: `${classification.name} 구독이 시작되었습니다.`,
            })
        }, 1500)
    }

  return (
    <Dialog>
      <DialogTrigger asChild>
        {children}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-headline">{classification.name} 구독</DialogTitle>
          <DialogDescription>
            결제를 진행하여 '{classification.name}' 카테고리의 모든 콘텐츠를 무제한으로 이용하세요.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
            <p className="font-semibold">결제 금액 (30일 이용권)</p>
            <p className="text-2xl font-bold">₩{new Intl.NumberFormat('ko-KR').format(classification.prices.day30)}</p>
            <p className="text-sm text-muted-foreground mt-4">실제 결제는 연결되지 않습니다. 이 화면은 데모용입니다.</p>
        </div>
        <DialogFooter>
            <DialogClose asChild>
                <Button variant="outline">취소</Button>
            </DialogClose>
            <DialogClose asChild>
                <Button onClick={handlePayment}>결제하기</Button>
            </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
