'use client';

import React, { useState } from 'react';
import { Bug, Trash2 } from 'lucide-react';
import { useDebugLog, type LogEntry } from '@/context/debug-log-context';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { AnimatePresence, motion } from 'framer-motion';

const getLogColor = (type: LogEntry['type']) => {
  switch (type) {
    case 'ERROR': return 'text-red-500';
    case 'WARNING': return 'text-yellow-500';
    case 'SUCCESS': return 'text-green-500';
    case 'INFO':
    default: return 'text-muted-foreground';
  }
};

export default function DebugOverlay() {
  const { logs, clearLogs } = useDebugLog();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 50, scale: 0.9 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="fixed bottom-24 right-6 z-[100]"
          >
            <Card className="w-96 h-[50vh] flex flex-col shadow-2xl">
              <CardHeader>
                <CardTitle className="text-lg">실시간 로그 모니터</CardTitle>
              </CardHeader>
              <CardContent className="flex-1 overflow-hidden p-0">
                <ScrollArea className="h-full px-6 py-2">
                  {logs.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center pt-10">로그가 없습니다.</p>
                  ) : (
                    <div className="space-y-2">
                      {logs.map(log => (
                        <div key={log.id} className="text-xs">
                          <span className="text-muted-foreground/50 mr-2">{log.timestamp.toLocaleTimeString()}</span>
                          <span className={cn(getLogColor(log.type))}>{log.message}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
              <CardFooter>
                <Button variant="outline" size="sm" onClick={clearLogs} className="w-full">
                  <Trash2 className="w-4 h-4 mr-2" />
                  로그 지우기
                </Button>
              </CardFooter>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      <Button
        size="icon"
        className={cn(
            "fixed bottom-6 right-6 z-[101] h-14 w-14 rounded-full shadow-lg transition-all",
            isOpen ? 'bg-destructive hover:bg-destructive/90' : 'bg-primary'
        )}
        onClick={() => setIsOpen(prev => !prev)}
      >
        <Bug className="h-6 w-6" />
      </Button>
    </>
  );
}
