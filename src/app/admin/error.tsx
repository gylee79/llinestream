'use client' // Error components must be Client Components
 
import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AlertTriangle } from 'lucide-react'
 
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Log the error to an error reporting service
    console.error("Admin section error:", error)
  }, [error])
 
  return (
    <div className="flex h-full items-center justify-center p-6">
        <Card className="w-full max-w-lg bg-destructive/10 border-destructive">
            <CardHeader className="text-center">
                <div className="mx-auto w-fit rounded-full bg-destructive/20 p-3">
                    <AlertTriangle className="h-8 w-8 text-destructive" />
                </div>
                <CardTitle className="mt-4 text-destructive">관리자 페이지 오류</CardTitle>
                <CardDescription className="text-destructive/80">
                    오류가 발생하여 페이지를 표시할 수 없습니다.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-center">
                <p className="text-sm text-destructive">
                    {error.message}
                </p>
                <Button
                    onClick={() => reset()}
                >
                    다시 시도
                </Button>
            </CardContent>
        </Card>
    </div>
  )
}
