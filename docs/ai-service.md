# Mac AI 서비스 운영

사용자 로그인 시 EVAN API와 임시 HTTPS 터널을 함께 실행합니다. 기존 Qwen vLLM과 뉴스 수집·분석 작업은 실행하거나 재시작하지 않습니다. API는 `127.0.0.1:8787`에만 바인딩하고 Cloudflare Quick Tunnel이 공개 HTTPS 주소를 제공합니다. 인증은 API의 접속 코드·세션 정책을 그대로 적용합니다.

## 준비

공식 Homebrew formula로 `cloudflared`를 설치합니다. 이 프로젝트는 `brew services start cloudflared`를 사용하지 않습니다. 한 감독 프로세스가 API와 터널을 함께 관리합니다.

```sh
brew install cloudflared
python3 -m venv server/.venv
server/.venv/bin/pip install -r server/requirements.txt
```

프로젝트 루트 `server/.env`에는 서버 전용 설정만 저장합니다. 접속 코드와 서명키는 환경 파일이나 명령 인수에 직접 쓰지 않고 `AI_CODE_AUTH_FILE`이 가리키는 비공개 자격 파일에서 읽습니다. 개인 접속 코드를 공개 화면·로그·GitHub 변수·저장소에 복사하지 않습니다. 코드 생성과 세션 설정은 서버 인증 문서를 따릅니다.

```dotenv
AI_CODE_AUTH_FILE=/absolute/private/path/access-credentials.json
NEWS_CSV_PATH=/absolute/private/path/news/outputs/news_analysis.csv
ALLOWED_ORIGINS=https://cwoonb.github.io,http://localhost:3000
VLLM_BASE_URL=http://127.0.0.1:8000/v1
QWEN_MODEL=qwen3.8-27b
VLLM_API_KEY=
RATE_LIMIT_DB=server/.state/rate-limits.sqlite3
CHAT_REQUESTS_PER_MINUTE=6
CHAT_REQUESTS_PER_DAY=100
```

환경 파일과 자격 파일은 같은 사용자가 소유한 일반 파일이어야 하며 권한은 `600`이어야 합니다. 파일은 Git에서 제외됩니다. 설정 파일은 셸로 실행하지 않습니다. 스크립트가 허용한 `NAME=value`만 파싱하고, 공백이 있는 값은 따옴표로 감쌉니다. `$(...)`, 백틱, 변수 확장, 임의 명령은 실행하지 않습니다. API에만 필요한 비밀 환경 값은 `gh`와 `cloudflared`에 전달하지 않습니다.

실행 전에 다음 명령으로 파일 권한·필수 실행 파일·실제 CSV 접근을 확인합니다. 서비스는 시작하지 않습니다.

```sh
server/.venv/bin/python scripts/run_ai_service.py check
```

GitHub CLI는 같은 Mac 사용자의 키체인 계정으로 인증되어 있어야 합니다. 공개 저장소 `cwoonb/EVAN`의 Actions Variables 수정과 `deploy.yml` 실행 권한이 필요합니다. `gh` 실패 출력·인증 토큰은 서비스 로그에 저장하지 않습니다.

## 로그인 자동 실행

저장소 루트에서 plist를 먼저 미리 볼 수 있습니다. 아래 명령에는 비밀 값이 들어가지 않습니다.

```sh
server/.venv/bin/python scripts/run_ai_service.py launch-agent --no-initial-dispatch
```

실제 등록과 즉시 시작은 `--install`로 수행합니다.

```sh
server/.venv/bin/python scripts/run_ai_service.py launch-agent --no-initial-dispatch --install
```

`~/Library/LaunchAgents/com.evan.ai-service.plist`를 생성하고 로그인 도메인에 등록합니다. `RunAtLoad`·`KeepAlive`로 감독 프로세스를 유지합니다. 현재 체크아웃의 가상환경 Python과 스크립트 절대 경로를 저장하므로 운영 체크아웃을 옮기면 다시 등록해야 합니다. 설치 명령은 같은 이름의 EVAN AI 작업만 교체합니다.

종료 유예 시간은 90초입니다. 진행 중인 GitHub 명령의 최대 대기와 API·터널 자식 정리를 마치도록 기다립니다.

이 Mac의 감독 프로세스는 기존 전체 디스크 접근 권한을 받은 Command Line Tools Python 3.9를 사용합니다. API 자식 프로세스는 `server/.venv/bin/python`의 Python 3.12를 사용합니다. 두 경로는 `--supervisor-python`과 `--python`으로 각각 지정할 수 있습니다. vLLM 가상환경과 모델 설정은 변경하지 않습니다.

`--no-initial-dispatch`는 **처음 한 번만** GitHub의 `EVAN_API_URL`을 새 공개 주소로 설정하고 Pages 배포는 운영자에게 맡깁니다. 첫 코드 배포와 중복 배포를 막는 옵션입니다. 첫 설정 상태는 비공개 디스크에 남습니다. 이후 터널 주소가 변경되면 자동으로 변수를 갱신하고 `deploy.yml`의 `main` 배포를 요청합니다. 첫 배포를 별도로 할 필요가 없다면 이 옵션을 생략합니다.

등록 없이 터미널에서 운영할 때는 다음 명령을 사용합니다. LaunchAgent와 동시에 실행하지 않습니다.

```sh
server/.venv/bin/python scripts/run_ai_service.py run --no-initial-dispatch
```

`--no-publish`는 로컬 운영 점검용입니다. 이 옵션을 사용하면 GitHub 변수나 배포를 변경하지 않습니다. 다른 저장소로 운영하려면 `--repo owner/repository`를 지정합니다.

## 상태·중지·재시작

```sh
server/.venv/bin/python scripts/run_ai_service.py status
launchctl print "gui/$(id -u)/com.evan.ai-service"
```

상태 파일은 `server/.state/ai-service/status.json`입니다. 공개 HTTPS 주소, 감독·자식 PID, 마지막 갱신 시각, 배포 요청 상태만 포함합니다. 자격 파일·접속 코드·JWT·모델 키·기사 본문은 포함하지 않습니다. `ready`는 API와 터널의 HTTP 상태 확인을 통과했다는 뜻입니다. 모델의 실제 답변 성공은 별도 기사 질문으로 확인해야 합니다.

```sh
launchctl bootout "gui/$(id -u)/com.evan.ai-service"
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.evan.ai-service.plist"
```

첫 명령은 EVAN AI 로그인 작업을 중지합니다. 감독 프로세스가 만든 API와 터널이 종료된 뒤 둘째 명령으로 다시 시작합니다. 설정이나 서버 코드 변경 후에도 이 순서를 사용합니다. 강제 종료는 자식 프로세스 정리를 건너뛸 수 있으므로 정상 종료를 기다립니다.

터널 재시작 시 공개 주소가 바뀔 수 있습니다. 새 주소의 Pages 배포가 완료될 때까지 사이트의 AI 연결이 잠시 실패할 수 있습니다. 뉴스 정적 데이터와 기존 뉴스 동기화 작업은 이 과정과 별개로 유지됩니다.

## 장애 처리와 로그

- `service.lock`의 배타 잠금으로 같은 상태 디렉터리에서 감독 프로세스가 중복 실행되지 않습니다. 8787 포트에 기존 프로세스가 있으면 해당 프로세스를 종료하지 않고 시작을 거부합니다.
- API가 준비된 뒤 터널을 시작합니다. 터널의 공개 `/healthz`도 확인한 뒤 URL을 게시합니다. `https://<단일호스트>.trycloudflare.com` 형식의 원점만 허용합니다. 경로·쿼리·계정 정보·다른 도메인은 게시하지 않습니다.
- 소유한 API 또는 터널이 종료되면 둘을 정리하고 5~60초 지연으로 재시작합니다. 종료 신호를 받으면 감독 프로세스가 만든 자식 프로세스 그룹만 정리합니다. vLLM을 종료하지 않습니다.
- GitHub 변수 갱신이나 배포 요청이 실패하면 터널을 유지하고 60초 뒤 재시도합니다. 배포 요청 성공과 실제 Pages 배포 완료는 구분합니다.
- `service.log`는 시작·정지·재시도 같은 고정된 운영 문구만 기록하고 1 MB 단위로 순환합니다. uvicorn 접근 로그와 자식 원문 출력은 저장하지 않습니다. `launcher.log`, `launcher-error.log`도 비공개 상태 디렉터리에 저장됩니다.
- 사용자 로그아웃·Mac 종료·잠자기·네트워크 단절 시 AI API를 사용할 수 없습니다. 정적 뉴스는 계속 열립니다. 재로그인 후 작업이 다시 시작됩니다. Desktop CSV 접근 권한 문제가 생기면 `launcher-error.log`의 고정된 접근 오류를 확인하고 해당 Python의 macOS 파일 권한을 점검합니다.

상태 디렉터리는 `700`, 상태 파일과 새 로그는 `600` 권한으로 만듭니다. 런타임 파일은 `server/.state/` 아래에만 저장하고 Git에 추가하지 않습니다.

## 임시 주소의 한계

Quick Tunnel은 사용자 선택에 따른 임시 연결입니다. 계정이나 도메인이 없어도 사용할 수 있지만 재생성할 때 호스트가 바뀌고 가동 시간 보장이 없습니다. 이 연결은 SSE를 지원하지 않아 현재 API의 일반 JSON 응답을 사용합니다. 고정 운영 주소가 필요해지면 별도 Cloudflare 계정·도메인의 named tunnel로 교체해야 합니다.

공식 참고: [Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/), [Homebrew cloudflared formula](https://formulae.brew.sh/formula/cloudflared).
