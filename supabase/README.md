# 댓글과 로그인 설정

EVAN은 GitHub Pages의 정적 사이트를 유지합니다. 댓글과 로그인만 별도 Supabase 프로젝트의 Auth·PostgreSQL을 사용합니다. 계정과 키가 없는 현재 상태에서는 연결 준비 안내를 표시하며, 가짜 댓글이나 댓글 수를 표시하지 않습니다.

## 운영 프로젝트 연결

1. Supabase 프로젝트를 생성합니다. 기존 EVAN용 Supabase 프로젝트가 있다면 새 프로젝트 대신 재사용합니다.
2. SQL Editor에서 [`migrations/202610180001_news_comments.sql`](migrations/202610180001_news_comments.sql)을 데이터베이스 소유자로 한 번 실행합니다. 기존 뉴스 CSV·JSON·테이블을 삭제하거나 변경하지 않습니다. 이미 적용한 마이그레이션은 재실행하지 않습니다.
3. Authentication에서 Email 로그인을 활성화하고 이메일 확인을 유지합니다. Anonymous Sign-Ins는 사용하지 않습니다. 운영 메일 발송용 SMTP와 Auth 요청 제한을 설정합니다. 이 구현은 이메일 매직 링크를 사용하며 처음 인증한 이메일은 계정으로 생성됩니다.
4. Authentication의 URL Configuration에서 Site URL을 `https://cwoonb.github.io/EVAN/`으로 설정합니다. Redirect URLs에는 `https://cwoonb.github.io/EVAN/**`를 허용합니다. 로컬 개발에만 `http://localhost:3000/**`를 추가합니다. 기사 쿼리를 유지한 주소로 돌아온 뒤 SDK가 PKCE 코드를 교환합니다. 매직 링크를 요청한 기기와 브라우저에서 이메일 링크를 엽니다. 기본 이메일의 `{{ .ConfirmationURL }}` 링크를 유지합니다. 이 정적 앱에는 별도 `/auth/confirm` 서버 경로가 없습니다.
5. 프로젝트 URL과 **publishable key**를 확인합니다. 로컬에서는 저장소 루트 `.env.local`에 아래 값을 설정하고 개발 서버를 다시 시작합니다. `.env.example`은 빈 예제만 제공합니다.

   ```dotenv
   NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_KEY
   ```

6. GitHub 저장소 Settings → Secrets and variables → Actions → Variables에 `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`를 설정합니다. Pages 워크플로를 다시 실행합니다. 이 두 값은 브라우저가 사용하는 공개 설정입니다. `service_role`, `sb_secret_`, JWT 서명키, DB 비밀번호를 넣지 않습니다. 클라이언트는 실수로 입력된 비밀키나 service-role JWT를 연결 설정으로 거부합니다. 이미 공개 빌드에 비밀키를 넣었다면 해당 키를 폐기·교체해야 합니다.
7. AI 게이트웨이에도 같은 Supabase 프로젝트를 설정합니다. AI 서버의 비공개 설정은 [`../server/README.md`](../server/README.md)를 따릅니다. 기사 원문과 로컬 vLLM 주소는 Supabase 공개 댓글 데이터나 프론트엔드 환경 변수에 넣지 않습니다.

공개 API 스키마는 `public`만 사용합니다. `community_private`를 PostgREST의 Exposed schemas에 추가하지 않습니다. 브라우저가 뉴스 댓글 테이블에 직접 쓰도록 권한을 추가하지 않습니다.

## 저장 구조와 권한

- `community_profiles`: 공개 닉네임·계정 UUID·생성 시각만 저장합니다. 이메일과 관리자 권한은 공개 프로필에 없습니다. 닉네임은 댓글 등록 RPC에서 검증합니다.
- `news_comments`: 공개 JSON에 이미 있는 안정적인 URL 해시 `source.id`를 `article_id`로 사용합니다. 이슈 그룹이 바뀌어도 댓글은 원래 기사에 연결됩니다. 답글은 같은 기사의 최상위 댓글에만 연결합니다.
- `news_comment_reports`: 사유·추가 설명·신고 당시 댓글·신고자·처리 상태를 저장합니다. 일반 독자에게는 공개하지 않습니다. 같은 사용자는 댓글당 한 번 신고할 수 있습니다.
- `community_private.write_events`: 계정별 변경 제한을 검사합니다. `moderation_log`는 관리자 처리 기록입니다. 브라우저에 테이블·함수 권한을 주지 않습니다.

공개 SELECT는 게시된 댓글과 본문이 비워진 삭제 표시만 반환합니다. 숨김 댓글 본문은 RLS에서 제외합니다. 작성자 삭제는 본문을 지우고 답글 관계를 남깁니다. 작성자와 관리자 모두 지운 본문을 복원할 수 없습니다. 댓글은 항상 `reader_opinion`입니다. `@EVAN` 여부는 향후 확장용 메타데이터로만 저장하고 뉴스의 사실 분석이나 RAG 검색 자료에 섞지 않습니다.

모든 클라이언트 INSERT·UPDATE·DELETE 권한을 회수합니다. 로그인 후에도 RPC만 호출합니다. RPC는 `auth.uid()`와 서버의 이메일 확인·차단 상태로 작성자를 결정합니다. 외부 입력으로 작성자 UUID·중요도·관리자 권한을 받지 않습니다. SECURITY DEFINER 함수는 비어 있는 `search_path`와 완전한 스키마 이름을 사용합니다.

댓글은 1~2,000자, 링크는 최대 3개입니다. 제어 문자·중복 게시·예약된 관리자 닉네임을 차단합니다. 내용은 React 텍스트로 출력하며 HTML·마크다운으로 실행하지 않습니다. 계정별 쓰기는 PostgreSQL advisory lock으로 직렬화합니다. 등록은 15초 간격·시간당 20회, 신고는 10초 간격·시간당 10회, 수정과 삭제는 각각 5초 간격·시간당 30회입니다. 모든 성공한 변경은 합계 하루 100회로 제한합니다. Auth의 이메일 요청 제한도 별도로 유지합니다.

공개 댓글은 첫 50개를 최신순으로 읽고 더 불러올 수 있습니다. 열린 페이지는 60초마다 조회하며 실패하면 이미 표시한 댓글과 작성 중인 내용을 유지합니다. 등록·수정·삭제 후에도 다시 조회합니다. 실제 연결 오류를 성공으로 표시하지 않습니다.

## 신고 검토와 관리자 처리

신고 수만으로 댓글을 자동으로 숨기지 않습니다. 여러 계정이 정상 댓글을 검열하지 못하도록 관리자가 근거를 검토합니다. 운영자가 정기적으로 Supabase SQL Editor 또는 서버 도구로 `news_comment_reports`의 `pending` 항목을 확인해야 합니다. 공개 관리자 화면이나 자동 신고 알림은 포함하지 않습니다.

신뢰하는 관리자의 `app_metadata.role`만 서버 Admin API 또는 Supabase 관리 도구에서 `admin`으로 설정합니다. 사용자가 변경 가능한 `user_metadata`나 공개 닉네임은 권한 판단에 사용하지 않습니다. 변경 후 관리자가 다시 로그인해 새 JWT를 발급받아야 합니다. service-role 키로 Admin API를 호출하는 코드는 서버에서만 실행합니다.

SQL Editor처럼 데이터베이스 소유자로 처리할 때도 앱 JWT 문맥을 명시해 RPC의 동일한 검사를 통과시킵니다. 아래 값은 실제 관리자의 UUID와 검토한 댓글 UUID로 바꿉니다.

```sql
begin;
select set_config('request.jwt.claims',
  '{"sub":"ADMIN_USER_UUID","role":"authenticated","app_metadata":{"role":"admin"}}', true);
select public.moderate_news_comment('COMMENT_UUID'::uuid, 'hidden', '개인정보 노출 검토');
commit;
```

`published`로 변경하면 숨김 처리를 해제합니다. 삭제된 댓글에는 적용되지 않습니다. 처리된 댓글의 대기 신고는 `reviewed`가 되고 관리자 사유와 이전·새 상태가 감사 기록에 남습니다. 신고를 기각만 하려면 SQL Editor에서 해당 신고 상태를 `dismissed`로 바꾸고 운영 기록을 남깁니다.

## 로컬 보안 검증

```sh
npm ci
npm run test:comments
```

[`tests/comments.security.test.mjs`](tests/comments.security.test.mjs)는 실제 PostgreSQL 엔진인 PGlite에서 **운영 마이그레이션 그대로** 실행합니다. Supabase 전용 `auth.users`, `auth.uid()`, `auth.jwt()`만 격리된 테스트 DB에 재현합니다. 외부 계정이나 뉴스 데이터를 사용하지 않습니다. 43개 검사는 익명 공개 읽기, 로그인·이메일 확인, 소유권, 직접 쓰기 우회 방지, 같은 기사 답글, 본문·링크 한도, 중복·속도 제한, 비공개 신고, 관리자 메타데이터, 숨김·삭제 본문과 답글 보존을 확인합니다.

이 검사는 실제 Supabase 프로젝트의 메일 전송·PostgREST·외부 네트워크를 대신하지 않습니다. 설정 후 두 개의 실제 테스트 계정으로 로그인, 공개 읽기, 작성·답글·수정·삭제·신고를 확인하고, 다른 계정이 소유권을 우회할 수 없는지도 확인합니다. 운영 DB 설정 전에는 이 외부 연결 검증을 완료했다고 주장하지 않습니다.

공식 참고: [이메일 로그인](https://supabase.com/docs/guides/auth/auth-email-passwordless), [PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [DB 함수와 권한](https://supabase.com/docs/guides/database/functions).
