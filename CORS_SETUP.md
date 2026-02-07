# Firebase Storage 설정 안내 (CORS) - 더 이상 사용되지 않음

이 파일에 안내된 CORS 설정은 더 이상 필요하지 않습니다.

새로운 시스템은 각 사용자의 권한을 확인한 후, 비공개 파일에 접근할 수 있는 단기 유효 URL(Signed URL)을 동적으로 생성하여 비디오를 재생하는 방식으로 변경되었습니다.

이 방식은 CORS 설정 없이도 작동하며, 보안이 훨씬 강화되었습니다. 따라서 `gcloud storage buckets update` 또는 `gsutil setmeta` 명령어들을 실행하실 필요가 없습니다.
