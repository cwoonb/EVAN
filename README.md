# EVAN · AI News & Research Workspace

CSV의 Qwen 분석 결과를 실제 뉴스 탐색과 연결한 반응형 웹사이트입니다. 기존 뉴스 카드, 검색, 리서치와 프로젝트 디자인을 유지합니다.

## 실행

Node.js 24, Python 3과 npm을 사용합니다.

```sh
npm ci
python3 scripts/build_news_feed.py --csv /absolute/path/to/news_analysis.csv --output public/data/news.json
npm run dev
```

개발 서버는 `http://localhost:3000`에서 실행됩니다. 같은 Wi-Fi의 휴대폰은 컴퓨터의 LAN IP와 3000 포트로 접속할 수 있습니다. 원본 CSV와 생성한 `public/data/news.json`은 Git에서 제외됩니다. 데이터가 없으면 연결 상태를 표시하며 샘플 뉴스로 대체하지 않습니다.

```sh
npm run lint
npm run typecheck
npm test
GITHUB_PAGES=true NEXT_PUBLIC_BASE_PATH=/EVAN npm run build
```

## 뉴스 기능

- 홈: 실제 뉴스의 날짜별 브리핑, 중요도 3 이상, 점수별 카드 크기, 뉴스 탐색 연결.
- `/news`: 제목·요약·키워드·출처·이벤트·신규 기술 검색, 키워드와 중요도 필터, 최신순·중요도순 정렬.
- `/news?issue=...`: 통합 이슈의 요약, 사건 정보, 신규 기술 후보와 실제 기사 출처 목록.
- 전역 검색: 실제 뉴스와 기존 리서치·프로젝트 검색. `Command K` 또는 `Control K`로 엽니다.
- 뉴스 데이터는 60초마다 조회합니다. 탭으로 돌아오거나 네트워크가 복구되면 다시 확인합니다. 갱신 실패 시 이미 받은 데이터를 유지합니다.
- 홈의 뉴스 요약 질문은 저장된 실제 분석을 사용합니다. 자유 대화·파일 분석·리서치 보고서·프로젝트 사례는 기존 데모입니다. 브라우저에서 새 모델 추론을 실행하지 않습니다.

중요도는 원본 분석의 1~5 값을 유지합니다. 일반 1, 관심 2, 중요 3, 매우중요 4, 최고중요 5입니다. 탐색에서는 1~2도 조회할 수 있습니다. 신규 기술은 AI가 추출한 후보이며, 분석의 사실성과 날짜는 원문에서 확인해야 합니다.

## 데이터와 배포

- 공개 소스: [cwoonb/EVAN](https://github.com/cwoonb/EVAN)
- 비공개 데이터: `cwoonb/EVAN-news-data`
- 사이트: [EVAN](https://cwoonb.github.io/EVAN/)

원본 CSV는 Mac에 보관합니다. 추출 스크립트는 공개에 필요한 필드만 JSON으로 생성하고, 동기화 스크립트는 비공개 데이터 저장소에 저장합니다. 웹사이트의 GitHub Actions는 읽기 전용 deploy key로 최신 JSON을 읽어 Pages 산출물에 포함합니다. JSON API는 사이트의 `/data/news.json`입니다. 원본 CSV, 기사 전문, 모델 설정, 로컬 경로와 인증 키는 공개 소스 및 배포 산출물에 포함하지 않습니다.

Mac의 사용자 LaunchAgent가 로그인 중 60초마다 CSV 변경을 확인합니다. 변경이 있으면 검증·동기화·배포 요청을 수행합니다. GitHub Actions의 빌드·배포 시간과 브라우저의 조회 주기에 따라 반영까지 수 분이 걸릴 수 있습니다. Mac이 꺼져 있거나 잠자기 중이면 새 분석은 반영되지 않지만, 이미 배포된 뉴스는 GitHub Pages에서 계속 제공됩니다.

```sh
python3 scripts/sync_news.py --csv /absolute/path/to/news_analysis.csv --once
python3 scripts/install_news_sync.py --csv /absolute/path/to/news_analysis.csv --install
```

설정과 운영 방법은 [동기화 문서](docs/news-sync.md), CSV 컬럼과 사건 그룹핑은 [데이터 문서](docs/news-schema.md)를 참고합니다. 인증 정보는 GitHub CLI의 자격 증명 저장소와 Actions secret `NEWS_DATA_DEPLOY_KEY`를 사용합니다. 개인 키를 소스나 plist에 저장하지 않습니다.

## 파일 구성

```text
app/                    기존 화면과 뉴스 탐색 페이지
components/             헤더, 검색, 뉴스, 대화, 리서치
lib/news-feed.ts         공유 데이터 조회와 필터
scripts/                CSV 정규화·그룹핑·동기화·LaunchAgent 설치
tests/                  데이터 품질과 동기화 실패 복구 검사
docs/                   데이터 계약과 운영 방법
public/images/          로컬 이미지
public/fonts/           Pretendard 폰트와 라이선스
.github/workflows/      검사·Production Build·Pages 배포
```

이미지와 폰트 출처는 [ASSET-SOURCES.md](ASSET-SOURCES.md)에 기록했습니다.
