# 기사 리서치 플랫폼

기존 Next.js 정적 사이트와 GitHub Pages `/EVAN/` 배포를 유지합니다. 서버 API를 Pages 안에 넣지 않습니다. 뉴스 수집, LAYA/Qwen 배치 분석, CSV 저장, 보수적 사건 그룹핑, 비공개 JSON 저장소와 Mac 동기화는 기존 방식 그대로 사용합니다.

## 데이터 경계

- 공개 뉴스: `public/data/news.json`. 기존 version 1, 공개 기사 ID와 이슈 ID를 유지합니다. 기사별 중요도와 기존 분석의 이유·개발자 영향·핵심 사실·관찰 포인트만 선택 필드로 추가합니다. 원문 전체와 근거 인용문은 추가하지 않습니다.
- 서버 RAG: 서버의 `NEWS_CSV_PATH`에서 읽습니다. 브라우저가 전달한 기사 본문이나 출처 목록을 신뢰하지 않습니다. 현재 기사, 확인된 같은 사건과 관련 과거 기사, 전체 뉴스 범위를 구분합니다. 전체 뉴스는 현재 CSV에 보존된 데이터 범위이며 인터넷 실시간 검색을 의미하지 않습니다.
- 독자 의견: Supabase의 댓글 전용 테이블에 저장합니다. 뉴스 JSON·Qwen 사실 분석·RAG 검색 색인에 댓글을 섞지 않습니다. `@EVAN` 문자열도 독자 의견으로만 저장하며 자동 추론을 실행하지 않습니다.

CSV 원본 `article_id` 대신 이미 배포된 URL hash 기반 출처 `id`를 댓글의 `article_id`와 AI 요청의 `articleId`로 일관되게 사용합니다. 같은 사건에 새 출처가 붙어 이슈 ID가 바뀌어도 개별 기사의 대화·댓글 연결은 유지됩니다. 기존 raw `cluster_id`는 사건 검증을 통과한 그룹 안의 힌트로만 사용합니다.

## 외부 서비스

Supabase 설정과 SQL은 [`supabase/README.md`](../supabase/README.md), 게이트웨이 설정·인증·요청 제한은 [`server/README.md`](../server/README.md)에 있습니다. 로그인과 DB는 동일 Supabase 프로젝트를 사용합니다.

브라우저가 알아야 하는 공개 HTTPS API 주소와 Supabase publishable key는 공개 값입니다. 인증된 API의 내부 서버 주소·로컬 vLLM 주소·서비스 키·JWT 서명키는 서버에만 보관합니다. `.env*`, CSV, DB 파일, 런타임 상태는 Git에 포함하지 않습니다.

## 배포

Pages 워크플로는 저장소 Actions Variables `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `EVAN_API_URL`을 공개 빌드 설정으로 읽습니다. 값이 없으면 UI는 연결 준비 상태를 표시합니다. 서버는 별도 프로세스로 실행합니다. Supabase 프로젝트와 HTTPS API 운영 주소를 실제로 연결하기 전에는 AI 대화나 댓글이 운영 중이라고 표시하지 않습니다.

웹사이트는 정적 내보내기를 유지하므로 새 뉴스마다 동적 경로를 다시 만들 필요가 없습니다. `/news?issue=<id>&article=<source-id>`로 기사 상세를 열고, 공개 JSON은 기존처럼 60초마다 갱신됩니다. Mac이나 AI 서버가 꺼져도 마지막 뉴스와 Supabase의 공개 댓글은 각 호스팅 서비스에서 계속 제공됩니다.

## 뉴스 읽기 화면

상세 화면은 전체 이슈·기사 수, 갱신 시간, 수동 새로고침, 출처 수, 분석 처리 방식 설명을 표시하지 않습니다. 자동 갱신은 그대로 유지합니다. 제목·핵심 요약을 한 번만 표시한 뒤 사건의 주체·행동·대상, 요약에 없는 의미, 실제 적용 가능한 개발자 영향, 원문 기사, 대화 탭 순서로 읽습니다. 버전·사건 날짜와 원본 분석 상태는 데이터에 보존합니다.

`lib/news-presentation.ts`가 표시할 문장과 순서를 정합니다. 같은 사건의 출처가 여럿이면 통합 요약을 선택하며 개별 요약은 새로운 내용이 있을 때만 짧게 표시합니다. 비어 있는 값·반복 문장·직접적인 활용 방법이 없는 추상적 개발자 영향은 숨깁니다. 이는 원본 데이터를 수정하거나 새로운 사실을 생성하는 과정이 아닙니다. 의미가 다른 문장을 모두 식별하는 별도 언어 모델은 아니므로 편집 기준은 테스트와 실제 기사 화면에서 확인합니다.

한국어 제목·사건 표시는 별도 Qwen 캐시를 사용합니다. 생성 방법과 운영은 [표시 캐시 문서](news-display.md)를 참고합니다. 캐시가 없으면 기존 한국어 분석 제목을 사용하고, 한국어 정보 자체가 없으면 준비 상태를 표시합니다. 브라우저가 제목을 임의 생성하거나 번역 API를 호출하지 않습니다.

## 검증

```sh
npm run lint
npm run typecheck
python3 -m unittest discover -s tests -p 'test_*.py'
GITHUB_PAGES=true NEXT_PUBLIC_BASE_PATH=/EVAN npm run build
```

게이트웨이 의존성이 필요한 검사는 서버 가상환경에서 실행합니다. SQL 권한 검증 방법은 댓글 문서를 참고합니다. 실제 Supabase 계정·운영 게이트웨이가 없는 상태의 로컬 검증은 운영 인증·메일 전송·외부 연결 검증을 대체하지 않습니다.

참고 문서: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Supabase JWT](https://supabase.com/docs/guides/auth/jwts), [FastAPI CORS](https://fastapi.tiangolo.com/tutorial/cors/).
