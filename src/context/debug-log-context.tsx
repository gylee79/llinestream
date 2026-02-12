
'use client';

import React, { createContext, useState, useCallback, useContext, ReactNode, useMemo } from 'react';
import type { LogEntry, LogType } from '@/lib/types';

const errorTranslation: { [key: string]: string } = {
  'Access to fetch': '🔴 [보안] 창고(Storage) 보안 설정이 막혀 있습니다. CORS 설정을 확인하세요.',
  '403': '⛔ [권한] 접근 권한이 없습니다. (서명된 URL 만료 또는 비로그인)',
  'Forbidden': '⛔ [권한] 접근 권한이 없습니다. (서명된 URL 만료 또는 비로그인)',
  '404': '🔍 [파일] 해당 파일을 찾을 수 없습니다. 경로가 틀렸거나 파일이 삭제되었습니다.',
  'Not Found': '🔍 [파일] 해당 파일을 찾을 수 없습니다. 경로가 틀렸거나 파일이 삭제되었습니다.',
  'Failed to fetch': '🌐 [통신] 서버와 연결할 수 없습니다. 인터넷 상태를 확인하세요.',
  'Network Error': '🌐 [통신] 서버와 연결할 수 없습니다. 인터넷 상태를 확인하세요.',
  'AbortError': '✋ [취소] 사용자가 로딩을 중단했습니다.',
};

const translateError = (message: string): string => {
    for (const key in errorTranslation) {
        if (message.includes(key)) {
            return errorTranslation[key];
        }
    }
    return `🔴 [오류] ${message}`;
};

interface DebugLogState {
  logs: LogEntry[];
}

interface DebugLogActions {
  addLog: (type: LogType, message: string) => void;
  clearLogs: () => void;
}

const DebugLogStateContext = createContext<DebugLogState | undefined>(undefined);
const DebugLogDispatchContext = createContext<DebugLogActions | undefined>(undefined);

export const DebugLogProvider = ({ children }: { children: ReactNode }) => {
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const addLog = useCallback((type: LogType, message: string) => {
    let processedMessage = message;
    if (type === 'ERROR') {
      processedMessage = translateError(message);
    } else if (type === 'SUCCESS') {
      processedMessage = `✅ ${message}`;
    } else if (type === 'INFO') {
      processedMessage = `ℹ️ ${message}`;
    } else if (type === 'WARNING') {
      processedMessage = `⚠️ ${message}`;
    }

    const newLog: LogEntry = {
      id: `${Date.now()}-${Math.random()}`,
      timestamp: new Date(),
      type,
      message: processedMessage,
    };
    setLogs(prev => [newLog, ...prev]);
  }, []);

  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  const dispatchValue = useMemo(() => ({ addLog, clearLogs }), [addLog, clearLogs]);
  const stateValue = useMemo(() => ({ logs }), [logs]);

  return (
    <DebugLogStateContext.Provider value={stateValue}>
      <DebugLogDispatchContext.Provider value={dispatchValue}>
        {children}
      </DebugLogDispatchContext.Provider>
    </DebugLogStateContext.Provider>
  );
};

export const useDebugLogState = () => {
  const context = useContext(DebugLogStateContext);
  if (!context) {
    throw new Error('useDebugLogState must be used within a DebugLogProvider');
  }
  return context;
};

export const useDebugLogDispatch = () => {
    const context = useContext(DebugLogDispatchContext);
    if (!context) {
      throw new Error('useDebugLogDispatch must be used within a DebugLogProvider');
    }
    return context;
}

export const useDebugLog = (): DebugLogState & DebugLogActions => {
  return {
    ...useDebugLogState(),
    ...useDebugLogDispatch(),
  }
}
