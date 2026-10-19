# 뉴스 CSV 공개 feed

`scripts/build_news_feed.py`는 기존 분석 CSV를 `types/news.ts`의 `NewsFeed` 계약에 맞는 공개 JSON으로 변환합니다. Python 표준 라이브러리만 사용합니다. 원래 분석기나 설정 모듈을 import하지 않으며, 모델 로딩이나 추가 LLM 요청을 하지 않습니다.

## 실행

```sh
python3 scripts/build_news_feed.py --csv /path/to/news_analysis.csv --output public/data/news.json
```

CSV 경로를 명시하지 않으면 `NEWS_CSV_PATH` 환경 변수를 사용합니다. 둘 다 없으면 오류로 종료합니다. 사용자별 절대 경로는 소스에 저장하지 않습니다. `--window-hours 72`로 동일 사건 기사의 최대 게시 시간 차이를 조절할 수 있습니다. 기본값은 72시간입니다.

```sh
python3 -m unittest discover -s tests -p test_news_pipeline.py -v
```

## 입력과 검증

필수 CSV 열은 `title`, `published`, `article_url`입니다. 기존 28개 열과 확장된 43개 열을 수용하되, 필요한 분석 열만 읽어 공개 필드로 변환합니다. UTF-8과 UTF-8 BOM을 지원합니다.

입력 열의 처리 범위는 다음과 같습니다.

| CSV 열 | 처리 |
| --- | --- |
| `title`, `published`, `source`, `article_url` | 공개 출처 제목·게시 시각·출처명·검증한 URL |
| `content` | 읽어 분석하거나 공개하지 않음 |
| `search_keyword`, `search_keywords` | 정규화한 `searchKeywords`로 통합 |
| `search_type`, `search_types` | 현재 공개 계약에 없어 제외 |
| `category`, `event_type` | 이슈 `category`, `eventType` |
| `important`, `important_score` | 위에 설명한 1–5 중요도 |
| `summary` | 기존 출처 요약과 통합 요약의 대체 문장 |
| `keywords` | 이슈 검색 키워드 |
| `keyword_types` | `company`, `model`, `product`, `technology`, `framework` 값만 키워드에 통합. 원래 JSON 객체나 다른 키는 공개하지 않음 |
| `new_technologies` | `newTechnologies` 후보 목록 |
| `article_id` | 원본 ID 대신 정규화 URL hash를 사용 |
| `cluster_id` | 충돌 검사 뒤 내부 그룹 힌트로만 사용. 원본 ID 제외 |
| `event_subject`, `event_action`, `event_object`, `event_version`, `event_date`, `event_summary` | 사건 비교와 공개 `event` 필드 |
| `laya_status` | 개별 모델 상태는 공개 계약에 없어 제외 |
| `qwen_status` | 기존 요약의 분석 출처를 `summaryMethod`에 정직하게 표시하는 데 사용 |
| `analysis_status` | `analysis.status`에 보존 |
| `why_it_matters`, `developer_impact` | 출처별 `analysis.whyItMatters`, `analysis.developerImpact` |
| `key_facts` | 문자열 또는 `{text, evidence}` 배열에서 `text`만 출처별 `analysis.keyFacts`로 공개. 원문 인용 `evidence`와 다른 키는 제외 |
| `watch_points` | 출처별 `analysis.watchPoints` |
| `content_status` | 본문 수집 상태만 `analysis.contentStatus`로 공개. 본문·수집 오류·내부 경로 제외 |
| `link`, `source_url`, `content_error`, `matched_queries`, `validated_search_keywords`, `rejected_search_keywords`, `relevance_status`, `ingested_at`, `content_last_attempt`, `content_attempts` | 기존 공개 계약과 무관한 수집 메타데이터는 제외 |

- `NaN`, `None`, `null`, `NaT`, `<NA>`, 공백은 빈 값으로 처리합니다. JSON에 `NaN`이나 `Infinity`를 쓰지 않습니다.
- 키워드 배열은 JSON 배열, Python 문자열 배열, 기존 `A | B` 형식을 지원합니다. JSON 외 Python 형식에는 `ast.literal_eval`만 사용하며 코드를 실행하지 않습니다. `keyword_types`의 다섯 가지 알려진 분류 값도 같은 규칙으로 평탄화하므로 기존 `keywords`가 비어 있어도 검색할 수 있습니다. 그 외 중첩 객체는 공개 키워드로 변환하지 않습니다.
- 제목, HTTP(S) 기사 URL, 게시일 중 하나가 유효하지 않으면 해당 행을 건너뜁니다. 날짜를 현재 시각으로 만들지 않습니다. 시간대 없는 유효 ISO 날짜는 UTC로 해석합니다.
- 비어 있는 파일, 헤더만 있는 파일, 잘못된 CSV 인용부호, 열 개수가 다른 행, 공개 가능한 기사가 하나도 없는 입력은 실패로 처리합니다. 잘린 CSV로 기존 feed가 지워지는 것을 방지합니다.
- URL의 사용자명·비밀번호, 로컬/사설 IP와 로컬 호스트를 거부합니다. tracking 인자, 인증 관련 query 인자와 fragment를 제거합니다. 기사 ID처럼 기능에 필요한 query 인자는 유지합니다.
- URL 중복 판정은 tracking 제거 후 HTTP/HTTPS, `www.`와 마지막 `/` 차이를 무시합니다. 같은 URL의 분석이 여러 개면 Qwen 성공 여부, 분석 필드 완성도, 중요도, 요약 길이와 고정 정렬 기준으로 대표를 선택합니다. 키워드는 합칩니다. 같은 제목만으로 URL을 중복 제거하지 않습니다.
- 유효한 `important_score` 1–5를 우선 보존합니다. 없으면 `일반=1`, `관심=2`, `중요=3`, `매우중요=4`, `최고중요=5`를 적용합니다. 둘 다 유효하지 않으면 1입니다. 이슈 중요도는 출처 중 최댓값이며 기사 수로 올리지 않습니다.

## 사건 그룹핑

`structured-event-complete-link-v1`은 새 LLM 판정이 아닌, 보수적인 규칙 기반 비교입니다. CSV의 `event_subject`, `event_action`, `event_object`, `event_version`, `event_date`와 제목, 게시 시각을 사용합니다. 검색어와 키워드만 같은 기사는 합치지 않습니다.

1. 주체가 같고 행동이 호환되어야 합니다. 출시·업데이트·투자·인수 등을 구분하며, 예정·협상·연기·취소·부인·추정 보도와 실제 실행을 구분합니다. 복합 행동은 행동 집합이 같아야 합니다. 알 수 없는 행동은 정규화한 원문이 같아야 합니다.
2. 두 기사 모두 사건 날짜가 있으면 날짜가 같아야 합니다. 명시한 버전과 제목/대상에서 인식한 제품 버전이 충돌하면 분리합니다. 날짜를 보완하거나 추정하지 않습니다.
3. 두 기사의 게시 시각 차이는 기본 72시간 이내여야 합니다. 그룹의 모든 기존 기사와 비교하므로 A/B와 B/C가 비슷하다는 이유로 충돌하는 A/C가 합쳐지지 않습니다.
4. 대상이 구체적으로 같거나 매우 비슷해야 합니다. 대상 token Jaccard가 0.8 이상이고 공통 token이 둘 이상이면 후보가 됩니다. 약한 대상 일치에는 대상 Jaccard 0.45 이상, 공통 token 셋 이상, 제목 Jaccard 0.5 이상의 추가 근거를 요구합니다. 일반적인 `AI` 같은 대상만으로는 묶지 않습니다.
5. 투자 금액, 소비자/기업 대상 등 확인 가능한 대상 충돌을 분리합니다. 포트폴리오 매매 제목의 투자자가 다른데 Qwen이 같은 기업 자사주 매입 배경을 추출한 경우에도 합치지 않습니다.
6. 기존 `cluster_id`는 판정을 강제하지 않습니다. 위 검사를 통과한 그룹 안에서 같은 ID가 실제로 반복될 때만 `+verified-cluster-hint`를 표시합니다. 같은 ID라도 버전·행동·대상·날짜 충돌은 분리합니다.

이 방식은 같은 실제 사건을 여러 이슈로 남길 수 있습니다. 특히 번역이 다르거나 추출 날짜가 틀렸거나, 표현이 많이 다른 경우를 자동으로 추측해 합치지 않습니다. 원본 Qwen 분석이 잘못 추출한 사건을 모두 탐지하는 의미 검증기는 아닙니다.

## 통합 요약과 분석 상태

그룹의 기존 `event_summary`를 우선 사용하며, 없으면 기존 `summary`를 사용합니다. 비슷한 문장을 제거한 뒤 최대 세 개를 연결합니다. 새 사실을 생성하거나 원문 전체를 다시 요약하지 않습니다.

- `existing-qwen-extractive-v1`: Qwen 성공 분석의 기존 문장을 선택·결합했습니다.
- `existing-analysis-extractive-v1`: Qwen 성공으로 확인되지 않은 기존 분석 문장을 사용했습니다.
- `existing-mixed-analysis-extractive-v1`: 위 두 종류를 함께 사용했습니다.
- `source-title-fallback`: 사용할 요약이 없어 원래 기사 제목을 사용했습니다.

`analysis.status`는 원본 `analysis_status`를 보존합니다. 서로 다른 상태가 섞인 그룹은 `mixed:`와 원래 상태 목록을 표시합니다. `partial_failed`여도 `qwen_status=ok`이면 기존 Qwen 요약을 활용합니다. 이를 새 검증 완료나 전체 분석 성공으로 바꾸지 않습니다. 원본 기사 요약, 사건 발생일, 중요도와 신기술 후보는 오류나 과거 정보가 섞일 수 있습니다. `newTechnologies`는 원본 후보 목록이며 신규성 검증 결과가 아닙니다.

## 공개 JSON 계약

필드 정의는 `types/news.ts`가 기준입니다.

- 최상위: `version: 1`, `revision`, `generatedAt`, `latestPublishedAt`, `stats`, `issues`.
- `stats`: `inputRows`, `articles`, `issues`, `duplicates`, `skipped`.
- `inputRows = articles + duplicates + skipped`이며, `articles`는 모든 `issues[].sources` 길이의 합입니다.
- 이슈: 식별자, 제목, 통합 요약, 중요도, 분류, 사건 유형, 최초/최신 게시 시각, 키워드/검색어/신기술 후보, 사건 필드, 출처 목록, 분석 상태/방법.
- 출처: `id`, `title`, `source`, `url`, `publishedAt`, `summary`, `searchKeywords`에 기사별 `importance`와 `analysis`를 추가합니다. 이미 배포된 version-1 JSON도 읽을 수 있도록 두 필드는 선택 사항입니다.
- 출처 `analysis`: `whyItMatters`, `developerImpact`, `keyFacts`, `watchPoints`, `contentStatus`만 포함합니다. 이유·영향은 각각 최대 1,200자, 사실·관찰 목록은 각각 최대 8개·항목당 600자입니다. 기존 Qwen 분석 문장을 보존하며 별도 검증된 사실로 승격하지 않습니다. 없으면 빈 값으로 남깁니다.
- 출처의 선택적 `display`: 별도로 캐시한 `titleKo`와 `event.subject/action/object`의 한국어 표시값입니다. 원본 제목·원문 URL·사건 정보는 그대로 보존합니다. 원본 입력 fingerprint가 일치하는 캐시만 사용하며 fingerprint와 캐시 내부 자료는 공개하지 않습니다. 표시 캐시가 없거나 손상되어도 뉴스 생성·동기화는 기존 분석으로 계속됩니다.
- `issue.publishedAt`은 그룹의 가장 이른 기사 게시 시각, `issue.updatedAt`은 가장 늦은 기사 게시 시각입니다. `latestPublishedAt`은 전체 출처의 가장 늦은 게시 시각입니다. 날짜 시각은 UTC ISO 8601 `Z` 형식입니다. `event.date`는 `YYYY-MM-DD` 또는 빈 문자열입니다.
- 공개 문자열 제한: 출처 제목 500자, 출처 요약 1,000자, 이슈 제목 160자, 통합 요약 약 1,103자 이내, 사건 요약 900자입니다.

원문 `content`, 개인 파일 경로, 분석 설정, 모델 경로, 인증 정보, 내부 cluster ID는 내보내지 않습니다. 공개 필드에 실수로 포함된 사용자 홈 경로나 알려진 credential 형태도 제거합니다. 공개 feed는 전체 허용 필드를 가진 기사·분석 자료이며, 원문 전체를 포함하지 않습니다.

## 안정성 및 동기화

기사 ID는 정규화 URL hash, 이슈 ID는 정렬한 출처 ID hash입니다. CSV 행 순서가 바뀌어도 ID·그룹·revision이 같습니다. 이슈의 출처 구성 자체가 바뀌면 이슈 ID가 바뀔 수 있습니다.

기사별 AI 질문과 댓글의 `article_id`는 이 공개 출처 ID를 사용합니다. 원래 CSV의 `art_*`와 다른 기존 공개 ID를 그대로 유지하므로 과거 링크와 댓글 연결이 그룹 재편으로 바뀌지 않습니다. 화면의 동일 사건은 기존 보수적 검사로 확인된 `issue.id`/`sources`를 기준으로 합니다. 원래 `cluster_id`가 같아도 사건 충돌 검사를 우회하지 않습니다.

`revision`은 `generatedAt`을 제외한 정규화 공개 데이터의 SHA-256 64자리 값입니다. 같은 입력을 다시 실행하면 생성 시각이 달라도 revision이 같습니다. 중요도 내림차순, 최신 기사 내림차순, 고정 ID 순서로 이슈를 정렬합니다.

직렬화를 먼저 완료하고, 출력과 같은 폴더에 임시 파일을 작성·flush·fsync한 뒤 `os.replace`로 교체합니다. 입력 오류나 교체 실패 시 기존 출력은 보존합니다. 오류 종료 코드는 1이며, 성공 시 stdout에 revision과 통계를 JSON 한 줄로 출력합니다. 생성 feed가 1MB를 넘을 수 있으므로 GitHub Contents API를 사용하는 동기화는 큰 파일 응답의 `encoding: none`을 처리해야 합니다. 기사 수를 임의로 잘라내지 않습니다.
