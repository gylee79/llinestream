# Firebase Storage 설정 안내 (CORS & VTT 자막)

이 파일은 **자막, 썸네일, 비디오 업로드** 기능이 정상적으로 동작하는 데 필요한 Firebase Storage 설정을 안내합니다. 아래 두 가지 명령어를 터미널에 복사하여 실행해주세요.

이 작업은 프로젝트 설정 시 **한 번만** 수행하면 됩니다.

---

## 1. CORS 정책 설정

웹 브라우저에서 Storage의 파일(자막, 이미지 등)에 접근할 수 있도록 허용하는 정책입니다.

```bash
gcloud storage buckets update gs://studio-6929130257-b96ff.appspot.com --cors-file=cors.json
```

### 명령어 설명
*   `gcloud storage buckets update`: Google Cloud Storage 버킷의 설정을 업데이트합니다.
*   `gs://studio-6929130257-b96ff.appspot.com`: 이 프로젝트의 Storage 버킷 주소입니다.
*   `--cors-file=cors.json`: 함께 제공된 `cors.json` 파일의 내용을 버킷의 CORS 정책으로 설정합니다.

---

## 2. VTT 자막 파일 Content-Type 일괄 수정

이미 업로드된 `.vtt` 자막 파일들이 브라우저에서 자막으로 올바르게 인식되도록 `Content-Type`을 `text/vtt`로 변경합니다.

```bash
gsutil -m setmeta -h "Content-Type: text/vtt" "gs://studio-6929130257-b96ff.appspot.com/**/*.vtt"
```

### 명령어 설명
*   `gsutil -m setmeta`: 여러 파일의 메타데이터를 병렬로 수정합니다.
*   `-h "Content-Type: text/vtt"`: 파일의 `Content-Type` 헤더를 `text/vtt`로 설정합니다.
*   `"gs://.../**/*.vtt"`: 버킷 내의 모든 폴더에 있는 모든 `.vtt` 파일을 대상으로 합니다.

---

## 실행 후

명령어 실행 후 별다른 오류 메시지가 없다면 설정이 완료된 것입니다. 이제 웹 애플리케이션에서 자막 및 파일 관련 기능이 정상적으로 작동할 것입니다.
