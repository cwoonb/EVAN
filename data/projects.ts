export interface ProjectItem {
  id: string;
  title: string;
  description: string;
  category: string;
  tech: string[];
  summary: string;
  status: string;
  highlights: string[];
  approach: { title: string; description: string }[];
  results: string[];
  relatedResearchId: string;
}

// Project concepts for this portfolio demo; no unverified production claims.
export const projects: ProjectItem[] = [
  {
    id: "news-intelligence",
    title: "AI 뉴스 인텔리전스",
    description: "흩어진 AI 뉴스를 중요도와 맥락으로 연결하는 리서치 작업공간",
    category: "AI Product",
    tech: ["Next.js", "TypeScript", "LLM", "RAG"],
    status: "인터랙티브 데모",
    summary:
      "뉴스를 읽는 데서 멈추지 않고, 기술의 의미를 질문하고 적용 아이디어까지 연결하는 공간을 설계했습니다. 현재 보고 있는 EVAN이 이 프로젝트의 인터랙티브 프론트엔드 데모입니다.",
    highlights: [
      "중요도 5·4·3의 시각적 정보 위계",
      "뉴스에서 맥락 있는 리서치로 연결",
      "보고서와 함께 사용하는 대화 인터페이스",
    ],
    approach: [
      {
        title: "선별",
        description:
          "원문을 수집하고 중복 기사와 같은 사건을 묶는 흐름을 구상했습니다.",
      },
      {
        title: "맥락화",
        description:
          "중요도, 기술 분류, 관련 리서치로 뉴스를 탐색하도록 구성했습니다.",
      },
      {
        title: "탐구",
        description:
          "보고서의 요약과 적용 아이디어를 대화로 확장하는 프론트엔드를 구현했습니다.",
      },
    ],
    results: [
      "홈, 리서치, 프로젝트를 연결하는 탐색 흐름",
      "데스크톱과 모바일에 대응하는 레이아웃",
      "API 없이 체험할 수 있는 로컬 데모 대화",
    ],
    relatedResearchId: "research-method",
  },
  {
    id: "job-agent",
    title: "채용 공고 AI Agent",
    description:
      "채용 공고의 요구 역량을 읽고 나에게 맞는 기회를 정리하는 에이전트",
    category: "AI Agent",
    tech: ["Python", "LLM", "Structured Output"],
    status: "설계 예시",
    summary:
      "여러 채용 공고의 직무, 기술 요구사항, 경력 조건을 같은 형식으로 정리합니다. 이 페이지는 구현 방향을 설명하는 포트폴리오 설계 예시입니다.",
    highlights: [
      "공고 정보의 구조화된 추출",
      "관심 조건과 요구 역량 비교",
      "원문 근거를 확인하는 검토 흐름",
    ],
    approach: [
      {
        title: "입력",
        description: "사용자가 제공한 공고 텍스트와 URL을 수집합니다.",
      },
      {
        title: "분석",
        description:
          "명시된 요구사항을 추출하고 필수 조건과 우대 조건을 분리합니다.",
      },
      {
        title: "검토",
        description:
          "원문과 요약을 함께 보여주고 사용자가 잘못 추출된 정보를 수정합니다.",
      },
    ],
    results: [
      "요구사항의 공통 비교 기준 정의",
      "추출 결과를 검토하는 인터페이스 설계",
      "외부 지원 행동 전 사용자 확인을 포함한 작업 흐름",
    ],
    relatedResearchId: "agent-workflows",
  },
  {
    id: "local-llm-lab",
    title: "로컬 LLM 인프라 구축",
    description:
      "모델 실행부터 문서 검색까지, 개인 환경에서 시작하는 AI 실험실",
    category: "AI Infrastructure",
    tech: ["Ollama", "Python", "Docker", "RAG"],
    status: "설계 예시",
    summary:
      "로컬 모델 실행, 문서 임베딩, 검색, 답변 생성을 분리한 실험 환경입니다. 데이터 처리 위치와 운영 비용을 직접 확인하는 구성을 설계했습니다.",
    highlights: [
      "모델과 검색 파이프라인 분리",
      "원문을 확인할 수 있는 답변",
      "메모리·지연 시간의 평가 기준",
    ],
    approach: [
      {
        title: "모델 실행",
        description:
          "장비 사양과 사용 목적에 맞는 모델과 양자화 설정을 선택합니다.",
      },
      {
        title: "문서 검색",
        description: "문서의 구조를 보존해 분할하고 필요한 근거를 검색합니다.",
      },
      {
        title: "평가",
        description:
          "동일한 질문으로 품질, 메모리 사용량, 응답 지연을 확인합니다.",
      },
    ],
    results: [
      "장비별 실험 항목과 비교 기준 정의",
      "모델을 교체할 수 있는 API 구조 설계",
      "문서 접근 권한을 고려한 검색 흐름",
    ],
    relatedResearchId: "local-llm",
  },
  {
    id: "vision-studio",
    title: "AI 이미지 분석 스튜디오",
    description:
      "이미지의 정보를 읽고 원하는 편집 방향을 함께 정리하는 작업공간",
    category: "Multimodal",
    tech: ["Next.js", "Vision API", "TypeScript"],
    status: "설계 예시",
    summary:
      "이미지에서 관찰할 수 있는 사실과 모델의 추론을 구분하고, 사용자가 원하는 편집 조건을 구조화하는 멀티모달 제품 개념입니다.",
    highlights: [
      "원본과 분석 결과의 나란한 검토",
      "사용자가 수정할 수 있는 추출 결과",
      "편집 목적과 보존 조건 정리",
    ],
    approach: [
      {
        title: "관찰",
        description: "이미지의 구도, 색감, 텍스트와 주요 대상을 분석합니다.",
      },
      {
        title: "방향 설정",
        description: "변경할 요소와 유지할 요소를 사용자가 정리합니다.",
      },
      {
        title: "검토",
        description: "결과와 원본을 비교하고 다음 수정 조건을 기록합니다.",
      },
    ],
    results: [
      "이미지 분석의 확인·수정 흐름 설계",
      "편집 요청을 재사용할 수 있는 조건 구조",
      "파일 처리 범위와 개인정보 확인 지점 정의",
    ],
    relatedResearchId: "multimodal-trends",
  },
  {
    id: "llm-benchmark",
    title: "LLM Benchmark",
    description:
      "내 서비스의 실제 질문으로 모델의 품질과 비용을 비교하는 평가 도구",
    category: "Developer Tool",
    tech: ["Python", "OpenAI API", "Gemini API", "Pandas"],
    status: "설계 예시",
    summary:
      "공개 순위만으로 결정하기 어려운 모델 선택을 돕기 위해, 같은 평가 세트를 여러 모델에 적용하는 실험 도구의 구조를 정리했습니다.",
    highlights: [
      "동일한 입력과 조건으로 비교",
      "품질·지연·토큰 사용량 함께 기록",
      "평가 기준과 실패 사례 보관",
    ],
    approach: [
      {
        title: "평가 세트",
        description: "서비스에서 쓰는 질문과 정답 또는 채점 기준을 작성합니다.",
      },
      {
        title: "실행",
        description: "모델별 요청 설정을 기록하고 같은 입력을 반복 실행합니다.",
      },
      {
        title: "분석",
        description: "결과를 익명 검토하고 비용과 품질의 균형을 비교합니다.",
      },
    ],
    results: [
      "재현 가능한 실험 데이터 구조 설계",
      "모델 변경 시 재검증할 기준 정의",
      "불확실한 결과와 실패 사례의 기록 방식",
    ],
    relatedResearchId: "llm-comparison",
  },
];

export const getProjectById = (id: string) =>
  projects.find((project) => project.id === id);
