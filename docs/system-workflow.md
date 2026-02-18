# [공식] LlineStream 비디오 시스템 워크플로우 (v6.3 - 단일 트리거)

**문서 목표:** 비디오 업로드부터 암호화, AI 분석까지 이어지는 전 과정을 기술적으로 명세합니다. 이 문서는 '상태 머신' 방식으로 동작하는 단일 오케스트레이터(총괄 관리자) 함수의 최종 설계도입니다.

---

## 1. 아키텍처 개요 (Orchestrator Pattern)

여러 함수가 각자 작동하던 기존 방식 대신, `episodeProcessingTrigger`라는 단일 함수가 Firestore 문서의 '상태' 변화를 감지하며 모든 단계를 순차적으로 지휘합니다. 이를 통해 타임아웃 문제를 해결하고, 작업의 순서와 안정성을 보장합니다.

```mermaid
graph TD
    A[사용자: 비디오 업로드] --> B(웹사이트: Firestore 문서 생성<br/>- status.pipeline = 'pending'<br/>- storage.rawPath 저장);
    
    subgraph "Cloud Function: episodeProcessingTrigger"
        B -- onWrite 트리거 --> C{상태 감지: 'pending'인가?};
        C -- 예 --> D[1. 비디오 처리 시작<br/>- FFmpeg 변환/분할<br/>- AES 암호화<br/>- Manifest.json 생성];
        D --> E{Firestore: 상태 업데이트<br/>- status.pipeline = 'completed'<br/>- ai.status = 'pending'};

        E -- onWrite 트리거 (재호출) --> F{상태 감지: pipeline='completed'이고<br/>ai='pending'인가?};
        F -- 예 --> G[2. AI 분석 시작<br/>- Gemini API 호출<br/>- 요약/타임라인 생성];
        G --> H{Firestore: 상태 업데이트<br/>- ai.status = 'completed'};

        H -- onWrite 트리거 (재호출) --> I{상태 감지: ai='completed'인가?};
        I -- 예 --> J[3. 최종 정리<br/>- 원본 비디오 파일(rawPath) 삭제];
    end
    
    J --> K([✅ 최종 완료]);
```

---

## 2. 상태 전이 및 핵심 로직

### **1단계: 비디오 처리**
-   **트리거 조건**: `episodes` 컬렉션에 새 문서가 생성되거나 업데이트될 때, `status.pipeline` 필드가 **`'pending'`** 인 경우에만 실행됩니다.
-   **핵심 작업**:
    1.  문서의 `storage.rawPath` 경로에 있는 원본 비디오를 다운로드합니다.
    2.  FFmpeg를 사용하여 비디오를 스트리밍에 적합한 fMP4 포맷으로 변환하고, 4초 단위의 DASH 세그먼트(`init.mp4`, `segment_*.m4s`)로 분할합니다.
    3.  각 세그먼트를 `AES-256-GCM` 방식으로 암호화하여 스토리지에 업로드합니다.
    4.  암호화된 세그먼트 목록을 담은 `manifest.json` 파일을 생성하여 업로드합니다.
    5.  암호화에 사용된 `masterKey`를 KEK로 다시 암호화하여 `video_keys` 컬렉션에 저장합니다.
-   **완료 후**: 작업이 성공하면, `status.pipeline`을 **`'completed'`** 로, `ai.status`를 **`'pending'`** 으로 업데이트합니다. 이 업데이트가 다시 함수를 트리거하여 2단계로 넘어갑니다.

### **2단계: AI 분석**
-   **트리거 조건**: `episodes` 문서가 업데이트될 때, `status.pipeline`이 `'completed'`이고, `ai.status`가 **`'pending'`** 인 경우에만 실행됩니다.
-   **핵심 작업**:
    1.  `storage.rawPath` 경로의 원본 비디오를 Google AI 서버로 업로드하여 분석을 요청합니다.
    2.  Gemini 모델을 통해 비디오 내용의 **요약(summary)**, **전체 대본(transcript)**, **타임라인(timeline)**을 JSON 형식으로 생성합니다.
    3.  생성된 요약/타임라인과 대본을 별도의 파일(`summary.json`, `transcript.txt`)로 스토리지에 저장합니다.
-   **완료 후**: 작업이 성공하면, `ai.status`를 **`'completed'`** 로 업데이트합니다. 이 업데이트가 다시 함수를 트리거하여 3단계로 넘어갑니다.

### **3단계: 최종 정리**
-   **트리거 조건**: `episodes` 문서가 업데이트될 때, `ai.status`가 **`'completed'`** 로 변경된 경우에만 실행됩니다.
-   **핵심 작업**:
    1.  더 이상 필요 없는 원본 비디오 파일(`storage.rawPath`)을 스토리지에서 삭제합니다.
    2.  Firestore 문서에서 `storage.rawPath` 필드를 제거합니다.
-   **완료 후**: 모든 작업이 종료됩니다.

---

## 3. 안정성 및 오류 처리
-   **단일 진입점**: 모든 작업은 `episodeProcessingTrigger` 하나를 통해 시작되고 관리되므로, 함수 간의 복잡한 호출 관계가 없습니다.
-   **상태 기반 실행**: 각 단계는 이전 단계가 성공적으로 완료되었음을 나타내는 '상태'를 기반으로 실행되므로, 순서가 꼬이거나 중복 실행될 위험이 없습니다.
-   **방어 코드**: 각 단계 시작 시, 필요한 데이터(예: `rawPath`)가 있는지 먼저 확인하고, 없을 경우 작업을 중단하고 명확한 오류를 기록하여 무한 대기 상태를 방지합니다.
-   **실패 기록**: 어느 단계에서든 오류가 발생하면, `status.pipeline` 또는 `ai.status`를 `'failed'`로 설정하고 `error` 필드에 상세한 원인을 기록하여 문제 추적을 용이하게 합니다.
