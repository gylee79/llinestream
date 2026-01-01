'use server';

import { genkit } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';

// [핵심 변경] 모듈 전체를 객체로 가져옵니다.
import * as GenkitFirebase from '@genkit-ai/firebase';

export const ai = genkit({
  plugins: [
    googleAI(),
    // [핵심 변경] 안전하게 함수를 꺼내서 실행합니다.
    // GenkitFirebase.firebase가 함수면 실행하고, 없으면 default 안에서 찾습니다.
    GenkitFirebase.firebase 
      ? GenkitFirebase.firebase() 
      : (GenkitFirebase as any).default?.firebase 
        ? (GenkitFirebase as any).default.firebase()
        : (GenkitFirebase as any).default(), 
  ],
});
