# LlineStream 보안 및 암호화 관련 파일 목록

사장님의 요청에 따라, 현재 비디오 재생 및 다운로드 문제와 관련된 모든 보안 및 암호화 관련 파일 목록을 정리했습니다. 외부 분석에 이 자료를 활용하실 수 있습니다.

## 1. 핵심 비밀 키 (KEK) 설정 및 관리

이 파일들은 비밀 키(`KEK_SECRET`)를 서버 환경에 주입하고 관리하는 역할을 합니다.

-   **`apphosting.yaml`**: 웹 서버(App Hosting)가 어떤 비밀 키를 Secret Manager에서 가져와 사용해야 하는지 정의하는 가장 중요한 설정 파일입니다.
-   **`functions/src/index.ts`**: 암호화 서버(Cloud Function)가 어떤 비밀 키를 사용해야 하는지 정의하는 설정 파일입니다.
-   **`.env`**: 로컬 개발 환경에서 사용할 환경 변수(비밀 키 등)를 정의할 수 있는 파일입니다. (현재는 비어 있음)

## 2. 서버 측 암호화 및 키 처리 로직

이 파일들은 실제 암호화 로직, 키 유도, 사용자 인증 및 권한 확인을 담당합니다.

-   **`src/lib/firebase-admin.ts`**: 서버 환경에서 `KEK_SECRET`을 불러와, 암호화된 '마스터 키'를 해독하는 핵심 로직이 들어있습니다. **"열쇠가 맞지 않음" 오류는 이 파일의 `decryptMasterKey` 함수에서 발생할 가능성이 가장 높습니다.**
-   **`src/app/api/play-session/route.ts`**: 온라인 스트리밍 시, 사용자의 구독을 확인하고 암호 해독에 필요한 **임시 세션 키**를 생성하여 전달하는 API입니다.
-   **`src/app/api/offline-license/route.ts`**: 오프라인 다운로드 시, 사용자의 구독을 확인하고 **오프라인용 라이선스 키**를 생성하여 전달하는 API입니다. 여기서 "Unsupported state" 오류가 발생하고 있습니다.
-   **`src/app/api/video-url/route.ts`**: 사용자의 권한을 확인한 후, 암호화된 비디오 파일에 접근할 수 있는 단기 유효 URL을 생성하는 API입니다.
-   **`functions/src/index.ts`**: 비디오가 업로드될 때, `KEK_SECRET`을 사용하여 '마스터 키'를 암호화하고, 비디오 파일을 청크 단위로 암호화하는 로직이 포함되어 있습니다.
-   **`src/lib/types.ts`**: `EncryptionInfo`, `VideoKey`, `OfflineLicense` 등 보안과 관련된 모든 데이터 구조가 정의되어 있습니다.

## 3. 클라이언트 측 암호 해독 로직

서버에서 받은 키를 이용해 실제 비디오 데이터의 암호를 푸는 곳입니다.

-   **`src/workers/crypto.worker.ts`**: 웹 브라우저의 별도 스레드에서, 서버로부터 받은 키와 암호화된 비디오 데이터를 이용해 실제 암호 해독을 수행하는 파일입니다. "Unsupported state" 오류 메시지는 최종적으로 이 파일의 `crypto.subtle.decrypt` API 호출이 실패할 때 발생합니다.

## 4. 접근 제어 규칙

-   **`firestore.rules`**: Firestore 데이터베이스의 읽기/쓰기 권한을 정의합니다.
-   **`storage.rules`**: Firebase Storage의 파일 업로드/다운로드 권한을 정의합니다. (현재는 모든 접근을 허용하고 있으며, 실제로는 `video-url` API를 통한 서명된 URL로 접근을 제어합니다.)

## 5. 전체 워크플로우 설계 문서

-   **`docs/video-analysis-workflow.md`**: v5.3 최종 버전의 전체 암호화, 키 파생, 온라인/오프라인 재생, 워터마킹 등 모든 보안 관련 설계 사양이 명시된 공식 문서입니다. 현재 시스템은 이 문서의 규칙을 따라야 합니다.
