# 로컬 CSV와 GitHub Pages 동기화

뉴스 원본 CSV는 Mac에 보관합니다. `scripts/build_news_feed.py`가 사이트에 필요한 공개 필드만 JSON으로 추출합니다. `scripts/sync_news.py`는 이 JSON만 비공개 저장소 `cwoonb/EVAN-news-data`의 `data/news.json`에 저장하고, 공개 사이트 저장소 `cwoonb/EVAN`에 `news-updated` 배포 이벤트를 보냅니다.

배포는 공개 소스 저장소의 최신 `main`과 비공개 데이터 저장소의 최신 기본 브랜치를 읽습니다. 공개 사이트에는 제목, 요약, 키워드와 출처 등 JSON에 포함한 공개 필드가 제공됩니다. 원본 CSV, 전체 기사 본문, 로컬 파일 경로 및 인증 정보는 사이트 저장소나 Pages 산출물에 포함하지 않습니다.

## 사전 설정

1. Mac에 Python 3와 GitHub CLI `gh`를 설치합니다.
2. `gh auth login`으로 저장소 쓰기와 repository dispatch 권한이 있는 사용자 계정에 로그인합니다. 인증 정보는 GitHub CLI의 기존 자격 증명 저장소를 사용합니다. 토큰을 소스, plist 또는 `.env` 파일에 저장하지 않습니다.
3. 비공개 저장소 `cwoonb/EVAN-news-data`를 만듭니다.
4. 이 비공개 저장소에 읽기 전용 SSH deploy key를 추가합니다. 해당 개인 키를 공개 사이트 저장소의 Actions secret `NEWS_DATA_DEPLOY_KEY`로 등록합니다. 쓰기 권한은 부여하지 않습니다.
5. 사이트 저장소의 Pages 배포 소스를 GitHub Actions로 설정합니다.

## 수동 동기화

다음 명령의 CSV 경로를 실제 원본 파일의 절대 경로로 바꿉니다.

```bash
cd /path/to/EVAN
python3 scripts/sync_news.py \
  --csv '/absolute/path/to/news.csv' \
  --repo cwoonb/EVAN-news-data \
  --site-repo cwoonb/EVAN \
  --once
```

명령은 한 번만 확인하고 종료합니다. `--once`를 생략해도 같습니다. CSV의 파일 크기와 수정 시각이 1초 동안 안정적인지 확인한 뒤 추출합니다. 추출 중 CSV가 바뀌거나 검증이 실패하면 업로드하지 않고 이전 공개 데이터를 보존합니다.

공개 데이터의 `revision`이 마지막 배포 요청과 같으면 GitHub를 호출하지 않습니다. 데이터가 바뀌면 REST Contents API에 현재 파일의 SHA를 전달해 충돌을 감지합니다. 강제 푸시는 사용하지 않습니다. GitHub 요청과 추출 명령에는 각각 90초 제한이 있습니다.

데이터 업로드 후 배포 요청에 실패하면 로컬 성공 상태를 갱신하지 않습니다. 다음 실행은 비공개 저장소의 동일한 revision을 확인하고 업로드를 반복하지 않은 채 배포 요청을 재시도합니다. 성공 상태는 GitHub Actions가 배포를 완료했다는 뜻이 아니라 배포 요청을 접수했다는 뜻입니다. 실제 결과는 Actions에서 확인합니다.

## 로그인 중 자동 확인

설치 전 명령과 경로를 검토할 수 있습니다. 다음 명령은 plist를 출력하며 설치하지 않습니다.

```bash
python3 scripts/install_news_sync.py --csv '/absolute/path/to/news.csv'
```

검토한 설정으로 사용자 LaunchAgent를 설치합니다. 관리자 권한이나 `sudo`는 필요하지 않습니다.

```bash
python3 scripts/install_news_sync.py \
  --csv '/absolute/path/to/news.csv' \
  --install
```

설치 파일은 `~/Library/LaunchAgents/com.evan.news-sync.plist`입니다. Python 실행 파일과 `gh` 실행 파일은 설치 시 찾은 절대 경로를 사용합니다. 로그인 시 한 번 실행하고 이후 60초마다 확인합니다. 같은 작업이 아직 실행 중이면 중복 실행하지 않습니다. Mac이 꺼져 있거나 잠자기 중일 때는 갱신하지 않습니다. 수집기가 CSV를 바꾸면 다음 확인에서 반영하고 GitHub Actions 빌드와 배포가 이어집니다.

작업 중지:

```bash
launchctl bootout "gui/$(id -u)/com.evan.news-sync"
```

다시 활성화하려면 위의 `--install` 명령을 실행합니다. 자동 시작도 제거하려면 작업을 중지한 뒤 plist 파일을 삭제합니다. CSV나 사이트 데이터는 삭제하지 않습니다.

## 로컬 상태와 진단

`.news-sync/`에는 성공한 revision과 저장소 이름을 담은 `state.json`, 중복 실행을 막는 잠금 파일, `sync.log`, `error.log`가 있습니다. 실행 중에는 공개 JSON 임시 파일이 생기며 실행이 끝나면 제거합니다. CSV를 복제하거나 인증 정보를 저장하지 않습니다. 이 디렉터리는 Git에서 제외합니다.

```bash
launchctl print "gui/$(id -u)/com.evan.news-sync"
tail -n 30 .news-sync/error.log
gh run list --repo cwoonb/EVAN --workflow deploy.yml --limit 5
```

개인정보가 섞인 원본이나 GitHub 응답 전체는 로그에 출력하지 않습니다. 검증 실패 시 기존 CSV와 수집기 상태를 확인한 후 다시 실행합니다. 인증 오류는 `gh auth status`로 확인합니다. 데이터 충돌은 다음 확인에서 최신 SHA를 읽어 재시도합니다.

로그는 launchd가 계속 추가하며 자동 순환하지 않습니다. 장기간 운영할 때는 필요에 따라 `.news-sync/sync.log`와 `.news-sync/error.log`를 보관하거나 비웁니다. 성공 상태 파일은 로그와 별개이므로 로그 정리는 동기화 상태를 바꾸지 않습니다.

## GitHub Actions

배포 workflow는 `main` 푸시, 수동 실행, `news-updated` 이벤트로 시작합니다. 연속 갱신이 실행 중인 배포를 계속 취소하지 않도록 `cancel-in-progress: false`를 사용합니다. 실행 대기 중인 이벤트는 GitHub의 concurrency 정책에 따라 합쳐질 수 있으며 각 실행은 최신 `main`과 최신 데이터를 확인합니다.

PR 검증은 비공개 저장소와 deploy key에 접근하지 않습니다. 실제 배포는 읽기 전용 deploy key와 유효한 JSON이 반드시 있어야 합니다. 키가 없거나 데이터를 읽지 못하면 배포 전에 실패하므로 기존 사이트가 유지됩니다.

배포 전 검증은 공개 JSON의 모든 필드를 허용 목록과 대조합니다. 정의하지 않은 원문·파일 경로·토큰 필드, 비어 있는 뉴스 목록, 잘못된 날짜·ID·중요도·URL, 항목 수와 맞지 않는 통계는 거부합니다. 비공개 데이터 저장소에 잘못된 JSON이 들어가도 그대로 공개하지 않습니다.

검증:

```bash
python3 -m unittest discover -s tests -p 'test_*.py'
```

동기화 테스트는 임시 파일과 가짜 GitHub 호출만 사용하며 외부 저장소를 변경하지 않습니다.
