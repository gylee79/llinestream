# Firebase Storage CORS 설정 안내

이 파일은 썸네일 및 비디오 업로드 기능이 정상적으로 동작하는 데 필요한 Firebase Storage의 CORS(Cross-Origin Resource Sharing) 정책을 설정하는 방법을 안내합니다. 이 작업은 웹 앱에서의 파일 접근을 허용하는 중요한 과정입니다.

**아래 명령어를 터미널에 복사하여 실행해주세요.** 이 작업은 프로젝트 설정 시 한 번만 수행하면 됩니다.

---

## 명령어 (아래 박스 안의 전체 라인을 복사하세요)

```bash
gcloud storage buckets update gs://studio-6929130257-b96ff.appspot.com --cors-file=cors.json
```

---

### 명령어 설명

*   `gcloud storage buckets update`: Google Cloud Storage 버킷의 설정을 업데이트하는 명령어입니다.
*   `gcloud storage buckets update gs://studio-6929130257-b96ff.firebasestorage.app --cors-file=cors.json`: 이 프로젝트의 올바른 Firebase Storage 버킷 주소입니다.
*   `--cors-file=cors.json`: 함께 제공된 `cors.json` 파일의 내용을 버킷의 CORS 정책으로 설정합니다.

### 실행 후

명령어 실행 후 별다른 오류 메시지가 없다면 설정이 완료된 것입니다. 이제 웹 애플리케이션에서 파일 업로드 및 표시 기능이 정상적으로 작동할 것입니다.
