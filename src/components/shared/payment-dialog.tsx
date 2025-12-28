
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
import type { Course } from "@/lib/types"
import type { PortOnePaymentRequest, PortOnePaymentResponse } from "@/lib/portone";
import { useToast } from "@/hooks/use-toast"
import { useUser } from "@/firebase/hooks"
import { v4 as uuidv4 } from "uuid";

declare global {
  interface Window {
    PortOne: any;
  }
}

interface PaymentDialogProps {
    children: React.ReactNode;
    item: Course;
    itemType: 'course';
    selectedDuration: keyof Course['prices'];
    selectedPrice: number;
    selectedLabel: string;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
}

export default function PaymentDialog({ 
    children, 
    item,
    itemType,
    selectedDuration,
    selectedPrice,
    selectedLabel,
    open,
    onOpenChange
}: PaymentDialogProps) {
    const { toast } = useToast();
    const { user } = useUser();
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
        
        const storeId = process.env.NEXT_PUBLIC_PORTONE_STORE_ID;
        const channelKey = process.env.NEXT_PUBLIC_PORTONE_CHANNEL_KEY;

        if (!storeId || !channelKey) {
            console.error("환경변수 에러: PortOne 설정이 누락되었습니다.");
            toast({ variant: 'destructive', title: '설정 오류', description: '결제 설정이 누락되었습니다. 관리자에게 문의하세요.' });
            return;
        }

        const paymentId = `pmt-${uuidv4().replaceAll('-', '')}`;

        const request: PortOnePaymentRequest = {
            storeId,
            channelKey,
            paymentId,
            orderName: `${item.name} ${selectedLabel}`,
            totalAmount: selectedPrice,
            currency: 'KRW',
            payMethod: 'CARD',
            customer: {
                customerId: user.id,
                fullName: user.name,
                phoneNumber: user.phone,
                email: user.email,
            },
            // 포트원 권장: 서버가 결제 이벤트를 직접 수신할 웹훅 URL
            noticeUrls: [`${window.location.origin}/api/webhook/portone`],
            // 사용자가 결제 완료 후 돌아올 주소
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

    // If 'open' and 'onOpenChange' are provided, use it as a controlled dialog
    if (open !== undefined && onOpenChange) {
        return (
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="font-headline">수강권 구매</DialogTitle>
                        <DialogDescription>
                            이 콘텐츠를 시청하려면 {item.name} 수강권이 필요합니다.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="py-4">
                        <p className="font-semibold">{`결제 상품: ${selectedLabel}`}</p>
                        <p className="text-2xl font-bold">₩{new Intl.NumberFormat('ko-KR').format(selectedPrice)}</p>
                        <p className="text-sm text-muted-foreground mt-4">결제하기 버튼을 누르면 포트원 결제창으로 이동합니다.</p>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => onOpenChange(false)}>다음에</Button>
                        <Button onClick={handlePayment} disabled={!isSdkReady}>
                            {isSdkReady ? '결제하기' : '결제 모듈 로딩 중...'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        );
    }
    
    // Default behavior as a triggered dialog
    return (
        <Dialog>
        <DialogTrigger asChild>
            {children}
        </DialogTrigger>
        <DialogContent>
            <DialogHeader>
            <DialogTitle className="font-headline">{item.name} 수강권 구매</DialogTitle>
            <DialogDescription>
                {`결제를 진행하여 '${item.name}' 강좌의 모든 에피소드를 무제한으로 이용하세요.`}
            </DialogDescription>
            </DialogHeader>
            <div className="py-4">
                <p className="font-semibold">{`결제 금액 (${selectedLabel})`}</p>
                <p className="text-2xl font-bold">₩{new Intl.NumberFormat('ko-KR').format(selectedPrice)}</p>
                <p className="text-sm text-muted-foreground mt-4">버튼 클릭 시 포트원 결제창으로 이동합니다.</p>
            </div>
            <DialogFooter>
                <DialogClose asChild>
                    <Button variant="outline">취소</Button>
                </DialogClose>
                <Button onClick={handlePayment} disabled={!isSdkReady}>
                    {isSdkReady ? '결제하기' : '결제 모듈 로딩 중...'}
                </Button>
            </DialogFooter>
        </DialogContent>
        </Dialog>
    )
}
