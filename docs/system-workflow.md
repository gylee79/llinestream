# [공식] LlineStream 비디오 시스템 워크플로우 (v6.1 - DASH)

**문서 목표:** 비디오 업로드부터 암호화, 온라인 스트리밍, 오프라인 재생, 워터마킹에 이르는 전 과정을 기술적으로 명세합니다. 이 문서는 시스템의 현재 구현 상태를 100% 반영하며, 모든 개발 및 유지보수의 기준점이 됩니다.

---

## 1. 아키텍처 개요

LlineStream은 `DASH (Dynamic Adaptive Streaming over HTTP)` 표준과 유사한 세그먼트 기반 스트리밍 방식을 채택하여, 안정적이고 효율적인 보안 스트리밍을 구현합니다.

```mermaid
graph TD
    A[사용자: 동영상 파일 업로드] --> B{Cloud Storage: 원본 임시 저장};
    B --> C{{Cloud Function: onDocumentWritten 트리거}};
    
    subgraph "Cloud Function: videoPipelineTrigger"
        C --> D[1. FFMPEG 트랜스코딩<br/>- fMP4 변환 (H.264/AAC)<br/>- DASH 세그먼트 생성];
        D --> E[2. AES-256-GCM 암호화<br/>- MasterKey로 각 세그먼트 암호화];
        E --> F[3. Manifest.json 생성<br/>- 코덱, 세그먼트 목록 등 저장];
        F --> G{Cloud Storage: 암호화 파일 저장<br/>- /init.enc<br/>- /segment_*.m4s.enc<br/>- /manifest.json};
        E --> H{Firestore: video_keys<br/>- MasterKey를 KEK로 암호화하여 저장};
        F --> I{Firestore: episodes<br/>- 메타데이터 업데이트};
    end

    subgraph "온라인 스트리밍"
        J[클라이언트: 재생 요청] --> K{API: /api/play-session};
        K --> L[1. MasterKey 복호화<br/>2. MasterKey 및 워터마크 시드 발급];
        L --> M[클라이언트: 비디오 플레이어];
        M --> N[manifest.json 요청];
        N --> O[세그먼트 순차 요청<br/>init.enc, segment_*.m4s.enc];
        O --> P[Web Worker: MasterKey로 실시간 복호화];
        P --> Q[MediaSource: 버퍼 주입 및 재생];
    end

    subgraph "오프라인 저장"
        R[클라이언트: 저장 요청] --> S{API: /api/offline-license};
        S --> T[1. MasterKey 복호화<br/>2. MasterKey를 포함한 라이선스 발급];
        T --> U[클라이언트: Manifest + 모든 세그먼트 다운로드];
        U --> V{IndexedDB: 암호화된 파일 전체 저장};
    end
```

---

## 2. 서버 측 처리 파이프라인 (Cloud Function)

모든 서버 측 처리는 `functions/src/index.ts`의 `videoPipelineTrigger` 함수에 의해 트리거되어 `processAndEncryptVideo` 함수에서 실행됩니다.

### 단계 1: FFmpeg 트랜스코딩 및 DASH 분할

-   **핵심 로직:** 비디오에 **오디오 트랙이 있는지 먼저 확인**하고, 있을 경우에만 오디오 코덱(`aac`) 변환을 실행하여 '소리 없는 비디오' 오류를 방지합니다.

### 단계 2: 세그먼트 단위 암호화

-   **암호화 키:** 각 비디오마다 고유한 `masterKey`가 `crypto.randomBytes(32)`로 생성됩니다.
-   **알고리즘:** `AES-256-GCM`을 사용하여 `init.mp4`와 모든 `segment_*.m4s` 파일을 개별적으로 암호화합니다.
-   **무결성 검증 (AAD):** 데이터 변조를 방지하기 위해, 각 세그먼트의 전체 스토리지 경로(`path:episodes/.../segment_1.m4s.enc`)를 AAD(추가 인증 데이터)로 사용합니다.

### 단계 3: 키 관리 및 저장

-   **KEK (Key Encryption Key):** `KEK_SECRET` 환경 변수에서 로드된 최상위 키(KEK)는 `masterKey`를 암호화하는 데 사용됩니다.
-   **저장:** KEK로 암호화된 `masterKey`는 `video_keys` 컬렉션에 해당 비디오의 `keyId`와 함께 저장됩니다. **(Salt는 더 이상 사용하지 않아 제거되었습니다.)**

---

## 3. 온라인 스트리밍 재생 (핵심 수정 사항)

**주요 파일:** `src/api/play-session/route.ts`, `src/workers/crypto.worker.ts`

### 단계 1: 재생 세션 요청
-   **API:** `/api/play-session`
-   **로직:**
    1.  서버는 `video_keys`에서 암호화된 마스터 키를 가져옵니다.
    2.  `KEK_SECRET`을 사용하여 **`masterKey`를 복호화**합니다.
    3.  **[수정됨]** 더 이상 HKDF로 새로운 키를 파생하지 않고, **복호화된 `masterKey` 자체**를 Base64로 인코딩하여 클라이언트에 전달합니다.
-   **응답 (핵심):**
    -   `derivedKeyB64`: 복호화된 **`masterKey`**의 Base64 인코딩 문자열.
    -   `watermarkSeed`: 워터마크 생성을 위한 고유 시드.

### 단계 2: Web Worker에서의 실시간 복호화
-   클라이언트는 서버로부터 받은 `derivedKeyB64` (실제로는 `masterKey`)를 사용하여 암호화된 각 세그먼트를 실시간으로 복호화합니다.
-   **핵심:** 암호화에 사용된 키(`masterKey`)와 복호화에 사용된 키(`derivedKeyB64`로 전달받은 `masterKey`)가 동일하므로, 복호화가 성공적으로 수행됩니다.

---

## 4. 오프라인 저장 및 재생

### 단계 1: 오프라인 라이선스 요청
-   **API:** `/api/offline-license`
-   **로직:**
    1.  온라인 스트리밍과 동일하게, `masterKey`를 복호화합니다.
    2.  **[수정됨]** HKDF 파생 로직을 제거하고, **복호화된 `masterKey` 자체**를 `offlineDerivedKey`라는 이름으로 Base64 인코딩하여 라이선스에 포함시켜 반환합니다.

### 단계 2: 콘텐츠 다운로드 및 IndexedDB 저장
-   `manifest.json`, 모든 세그먼트 파일, 그리고 `masterKey`가 포함된 라이선스를 다운로드하여 IndexedDB에 저장합니다.

### 단계 3: 오프라인 재생
-   플레이어는 IndexedDB에서 `masterKey`를 포함한 라이선스와 암호화된 세그먼트를 로드합니다.
-   온라인 스트리밍과 동일한 로직으로, `masterKey`를 사용하여 세그먼트를 복호화하고 `MediaSource`에 주입하여 재생합니다.

---

## 5. 결론

이번 v6.1 업데이트는 키 불일치라는 치명적인 논리적 오류를 수정하여, 암호화된 콘텐츠의 온라인 및 오프라인 재생을 모두 정상화하는 데 초점을 맞췄습니다. 또한, 오디오 없는 비디오 처리 문제를 해결하여 시스템의 안정성을 대폭 향상시켰습니다.
