
'use client'

import { useState, useEffect } from "react"
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
import type { PortOnePaymentRequest, PortOnePaymentResponse } from "@/lib/portone";
import { useToast } from "@/hooks/use-toast"
import { useUser } from "@/firebase"
import { v4 as uuidv4 } from "uuid";
import { useCart } from "@/context/cart-context";
import { formatPrice } from "@/lib/utils";

declare global {
  interface Window {
    PortOne: any;
  }
}

interface CartPaymentDialogProps {
    children: React.ReactNode;
}

export default function CartPaymentDialog({ children }: CartPaymentDialogProps) {
    const { toast } = useToast();
    const { user } = useUser();
    const { items, totalAmount, clearCart } = useCart();
    const [isSdkReady, setSdkReady] = useState(false);

    useEffect(() => {
        const script = document.createElement('script');
        script.src = 'https://cdn.portone.io/v2/browser-sdk.js';
        script.async = true;
        script.onload = () => setSdkReady(true);
        document.body.appendChild(script);

        return () => {
            document.body.removeChild(script);
        };
    }, []);

    const handlePayment = async () => {
        if (!isSdkReady || !window.PortOne) {
            toast({ variant: 'destructive', title: '결제 모듈 로딩 실패', description: '결제 모듈을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.' });
            return;
        }

        if (!user) {
            toast({ variant: 'destructive', title: '로그인 필요', description: '결제를 진행하려면 먼저 로그인해주세요.' });
            return;
        }

        if (items.length === 0) {
            toast({ variant: 'destructive', title: '장바구니 비어있음', description: '결제할 상품이 없습니다.' });
            return;
        }
        
        const storeId = process.env.NEXT_PUBLIC_PORTONE_STORE_ID;
        const channelKey = process.env.NEXT_PUBLIC_PORTONE_CHANNEL_KEY;

        if (!storeId || !channelKey || storeId === 'YOUR_PORTONE_STORE_ID') {
            console.error("환경변수 에러: PortOne 설정이 누락되었습니다.");
            toast({ variant: 'destructive', title: '설정 오류', description: '결제 설정이 누락되었습니다. 관리자에게 문의하세요.' });
            return;
        }

        const paymentId = `pmt-${uuidv4().replaceAll('-', '')}`;
        const orderName = items.length > 1 
            ? `${items[0].name} ${items[0].durationLabel} 이용권 외 ${items.length - 1}건` 
            : `${items[0].name} ${items[0].durationLabel} 이용권`;


        const request: PortOnePaymentRequest = {
            storeId,
            channelKey,
            paymentId,
            orderName: orderName,
            totalAmount: totalAmount,
            currency: 'KRW',
            payMethod: 'CARD',
            customer: {
                customerId: user.id,
                fullName: user.name,
                phoneNumber: user.phone,
                email: user.email,
            },
            noticeUrls: [`${window.location.origin}/api/webhook/portone`],
            redirectUrl: `${window.location.origin}/api/payment/complete`,
        };

        try {
            const response: PortOnePaymentResponse = await window.PortOne.requestPayment(request);

            if (response.code != null) {
                toast({
                    variant: "destructive",
                    title: "결제 오류",
                    description: `[${response.code}] ${response.message || '결제가 완료되지 않았습니다.'}`,
                });
                return;
            }

            console.log("결제 요청 성공 (리다이렉트 전):", response);
            // 성공 시 장바구니 비우기
            // 실제 데이터 처리는 웹훅에서 하므로, 여기서는 UI상에서만 비워줍니다.
            clearCart();

        } catch (error: any) {
            console.error("결제 요청 중 예외 발생:", error);
            const errorMessage = error.message || "결제 요청 중 문제가 발생했습니다. 관리자에게 문의하세요.";
            toast({
                variant: "destructive",
                title: "결제 시스템 오류",
                description: errorMessage,
            });
        }
    }

  return (
    <Dialog>
      <DialogTrigger asChild>
        {children}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-headline">장바구니 결제</DialogTitle>
          <DialogDescription>
            선택하신 상품에 대한 결제를 진행합니다.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
            <p className="font-semibold">{`총 결제 금액 (${items.length}개 상품)`}</p>
            <p className="text-2xl font-bold">{formatPrice(totalAmount)}</p>
            <p className="text-sm text-muted-foreground mt-4">버튼 클릭 시 포트원 결제창으로 이동합니다.</p>
        </div>
        <DialogFooter>
            <DialogClose asChild>
                <Button variant="outline">취소</Button>
            </DialogClose>
            <Button onClick={handlePayment} disabled={!isSdkReady || items.length === 0}>
                {isSdkReady ? '결제하기' : '결제 모듈 로딩 중...'}
            </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
