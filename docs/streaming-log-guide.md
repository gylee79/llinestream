
# 스트리밍 파이프라인 진단 로그 가이드 (v3 - 최종)

**중요: 이 파일은 HTTP Range 요청을 사용하는 고급 스트리밍(부분 콘텐츠 요청) 기능을 완벽하게 지원하기 위한 최신 CORS 설정 안내입니다.**

`Failed to fetch` 오류나 비디오 탐색(seeking) 문제를 해결하려면, 아래 명령어를 터미널에서 실행하여 프로젝트의 스토리지 버킷에 최신 CORS 정책을 적용해야 합니다. 이 정책은 클라이언트가 비디오의 특정 부분만 요청할 수 있도록 `Range`와 `Content-Range` 헤더를 허용합니다.

### **실행할 명령어**

아래 명령어를 복사하여 터미널에 붙여넣고 실행하세요.

```bash
gsutil cors set cors.json gs://studio-6929130257-b96ff.firebasestorage.app
```

**참고:**
* `gsutil`은 Google Cloud SDK에 포함된 커맨드라인 도구입니다. 아직 설치되지 않았다면 설치가 필요할 수 있습니다.
* 이 명령어는 프로젝트 루트에 있는 `cors.json` 파일을 읽어 스토리지 버킷에 적용합니다.

### `cors.json` 파일 내용

프로젝트 루트에 있는 `cors.json` 파일은 아래와 같은 내용이어야 합니다.

```json
[
  {
    "origin": ["*"],
    "method": ["GET", "HEAD", "OPTIONS"],
    "responseHeader": [
      "Content-Type",
      "Content-Length",
      "Content-Range",
      "Access-Control-Allow-Origin",
      "Range"
    ],
    "maxAgeSeconds": 3600
  }
]
```

**`Range`와 `Content-Range`가 `responseHeader`에 포함되어 있는지 반드시 확인하세요.**
