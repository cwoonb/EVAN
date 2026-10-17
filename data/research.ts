import { assetPath } from "@/lib/asset-path";
import type { ResearchItem } from "@/types/research";

const commonProcess = [
  {
    title: "질문 정의",
    description:
      "기술이 무엇을 할 수 있는지보다, 어떤 문제를 해결해야 하는지 먼저 정리했습니다.",
  },
  {
    title: "1차 자료 검토",
    description:
      "공식 기술 문서와 모델 카드를 읽고, 확인한 내용과 검증이 필요한 가설을 구분했습니다.",
  },
  {
    title: "작은 실험 설계",
    description:
      "동일한 입력과 평가 기준으로 비교할 수 있는 최소 실험을 설계했습니다.",
  },
  {
    title: "적용 조건 정리",
    description:
      "품질뿐 아니라 비용, 지연 시간, 데이터 관리와 운영 부담을 함께 검토했습니다.",
  },
];

export const research: ResearchItem[] = [
  {
    id: "llm-comparison",
    title: "LLM 모델 비교 분석",
    subtitle: "GPT-4 vs Gemini, 모델 선택의 기준을 다시 생각하다",
    summary:
      "벤치마크 점수 너머, 실제 서비스에서 중요한 품질·속도·비용의 균형을 살펴봅니다.",
    category: "LLM",
    date: "2025. 03. 10",
    image: assetPath("/images/server.jpg"),
    readTime: "8분",
    tags: ["LLM", "모델 평가", "GPT-4", "Gemini"],
    sections: [
      {
        title: "요약",
        body: "좋은 모델은 가장 큰 모델이 아니라, 서비스의 요구를 일관되게 만족하는 모델입니다. 이 리서치는 모델을 평가하는 방법과 선택 기준을 정리한 데모 보고서입니다. 실제 비교 측정값이나 최신 성능 순위를 제시하지 않습니다.",
      },
      {
        title: "비교해야 할 세 가지",
        body: "서비스의 입력과 성공 조건을 먼저 고정해야 의미 있는 비교가 가능합니다.",
        points: [
          "응답 품질: 사실 정확도, 지시 이행, 출력 형식의 일관성",
          "사용자 경험: 첫 토큰까지의 시간과 전체 응답 시간",
          "운영 비용: 입력·출력 토큰, 재시도, 캐시 적용 후의 전체 비용",
        ],
      },
      {
        title: "실험 설계",
        body: "실제 사용 질문을 요약, 추론, 코드, 문서 검색으로 나눕니다. 같은 프롬프트와 출력 제한을 적용하고 각 질문을 여러 번 실행합니다. 정답이 있는 항목은 자동 평가하고, 열린 질문은 사람이 익명으로 검토합니다.",
      },
      {
        title: "서비스 적용",
        body: "단순 분류와 요약에는 가벼운 모델을, 복잡한 추론에는 상위 모델을 배정하는 라우팅 전략을 검토할 수 있습니다. 모델 교체에 대비해 공급자 API를 서비스 로직에서 분리합니다.",
      },
    ],
    sources: [
      {
        title: "OpenAI API 문서",
        publisher: "OpenAI",
        url: "https://platform.openai.com/docs",
        description: "지원 기능과 API 사용 조건을 확인할 공식 문서입니다.",
      },
      {
        title: "Gemini API 문서",
        publisher: "Google",
        url: "https://ai.google.dev/gemini-api/docs",
        description: "모델 기능과 입력 형식을 검토할 공식 문서입니다.",
      },
      {
        title: "HELM",
        publisher: "Stanford CRFM",
        url: "https://crfm.stanford.edu/helm/",
        description:
          "다양한 시나리오에서 언어 모델을 평가하는 연구 프로젝트입니다.",
      },
    ],
    applications: [
      {
        title: "내 서비스용 평가 세트",
        description:
          "실제 사용자 질문 30개와 좋은 답변의 조건을 작성해 모델 변경 때마다 재검증합니다.",
        effort: "1–2일 실험",
      },
      {
        title: "비용을 고려한 모델 라우터",
        description:
          "질문 난이도와 출력 형식을 기준으로 모델을 선택하고 실패 시 상위 모델로 전환합니다.",
        effort: "프로토타입",
      },
      {
        title: "응답 품질 관찰",
        description:
          "사용자 피드백, 지연 시간, 토큰 사용량을 함께 기록해 실제 사용 품질을 확인합니다.",
        effort: "서비스 적용",
      },
    ],
    process: commonProcess,
  },
  {
    id: "agent-workflows",
    title: "AI 에이전트 실제 업무 적용 사례",
    subtitle: "자율성보다 중요한 것은 신뢰할 수 있는 작업 흐름",
    summary:
      "도구 사용, 명시적인 검토 단계, 복구 가능한 설계로 실제 업무에 AI를 연결합니다.",
    category: "AI Agent",
    date: "2025. 03. 09",
    image: assetPath("/images/agent.jpg"),
    readTime: "10분",
    tags: ["AI Agent", "자동화", "도구 사용"],
    sections: [
      {
        title: "요약",
        body: "업무용 에이전트의 핵심은 무조건적인 자율 실행이 아닙니다. 명확한 목표, 제한된 도구, 관찰 가능한 실행 과정이 필요합니다. 이 보고서는 구현을 위한 설계 예시이며 실제 고객 도입 성과를 뜻하지 않습니다.",
      },
      {
        title: "작업 흐름의 기본 구조",
        body: "입력 수집, 정보 추출, 판단, 결과 초안, 사람의 검토를 별도 단계로 나눕니다.",
        points: [
          "읽기 도구와 외부 변경 도구의 권한을 분리합니다.",
          "각 단계의 입력과 출력을 구조화하고 검증합니다.",
          "실패한 단계부터 다시 시작할 수 있도록 실행 상태를 저장합니다.",
        ],
      },
      {
        title: "적합한 업무",
        body: "다수 문서의 정보를 비교하거나 반복적으로 정리하는 업무가 출발점입니다. 채용 공고 수집, 회의록 후속 작업 추출, 뉴스 분류처럼 결과를 사람이 쉽게 검토할 수 있는 문제로 범위를 좁힙니다.",
      },
      {
        title: "검증 기준",
        body: "전체 성공률과 함께 도구 호출 실패율, 잘못된 외부 작업 수, 검토 시간을 측정합니다. 초안 작성과 외부 실행을 분리하고, 권한이 필요한 행동에는 명시적인 승인 단계를 둡니다.",
      },
    ],
    sources: [
      {
        title: "OpenAI Agents SDK",
        publisher: "OpenAI",
        url: "https://openai.github.io/openai-agents-python/",
        description: "도구, 실행 추적, 에이전트 구성의 공식 개발 문서입니다.",
      },
      {
        title: "LangGraph 문서",
        publisher: "LangChain",
        url: "https://docs.langchain.com/oss/python/langgraph/overview",
        description:
          "상태를 갖는 작업 흐름을 설계할 때 참고할 공식 문서입니다.",
      },
    ],
    applications: [
      {
        title: "채용 공고 분석 도우미",
        description:
          "공고에서 요구 역량을 추출하고 관심 조건과 비교한 뒤, 검토 가능한 요약을 만듭니다.",
        effort: "프로토타입",
      },
      {
        title: "팀 리서치 초안",
        description:
          "선별한 자료를 기준으로 주장별 출처와 미확인 질문을 함께 정리합니다.",
        effort: "1–2일 실험",
      },
      {
        title: "검토 가능한 업무 자동화",
        description:
          "외부 전송 전 초안과 변경 내용을 보여주고 사용자 승인을 받은 뒤 실행합니다.",
        effort: "서비스 적용",
      },
    ],
    process: commonProcess,
  },
  {
    id: "multimodal-trends",
    title: "멀티모달 AI 트렌드 리포트",
    subtitle: "텍스트, 이미지, 음성을 하나의 경험으로",
    summary:
      "여러 입력을 함께 이해하는 AI가 제품 경험을 어떻게 바꿀 수 있는지 정리합니다.",
    category: "산업 동향",
    date: "2025. 03. 08",
    image: assetPath("/images/multimodal.jpg"),
    readTime: "6분",
    tags: ["멀티모달", "Vision", "제품 설계"],
    sections: [
      {
        title: "요약",
        body: "멀티모달은 입력 버튼을 늘리는 기능이 아니라, 사용자가 설명해야 하는 부담을 줄이는 인터페이스입니다. 사진 속 정보를 질문의 맥락과 연결하는 작은 경험에서 출발할 수 있습니다.",
      },
      {
        title: "핵심 변화",
        body: "사용자는 이미지를 업로드한 뒤, 별도의 설명 없이도 그 이미지에 대한 질문을 이어갈 수 있습니다.",
        points: [
          "이미지와 텍스트의 맥락을 함께 다루는 대화",
          "문서의 표, 차트, 스크린샷을 활용하는 정보 추출",
          "음성 입력과 짧은 응답을 결합한 접근성 개선",
        ],
      },
      {
        title: "제품 적용 시 고려사항",
        body: "이미지의 해상도, 촬영 조건, 개인정보, 처리 비용을 함께 검토해야 합니다. 인식 결과를 사용자가 확인하고 수정할 수 있어야 하며, 확실하지 않은 답변을 구분해 보여줍니다.",
      },
      {
        title: "다음 실험",
        body: "화면 캡처 한 장에서 필요한 항목을 추출하는 흐름을 만듭니다. 원본 이미지와 추출 결과를 나란히 보여주고, 수정 횟수와 완료 시간을 기준으로 유용성을 확인합니다.",
      },
    ],
    sources: [
      {
        title: "Gemini 이미지 이해 가이드",
        publisher: "Google",
        url: "https://ai.google.dev/gemini-api/docs/image-understanding",
        description: "이미지 입력과 활용 방법을 확인할 공식 문서입니다.",
      },
      {
        title: "OpenAI 이미지 입력 가이드",
        publisher: "OpenAI",
        url: "https://platform.openai.com/docs/guides/images-vision",
        description: "시각 입력의 사용 방법과 제한을 확인할 공식 문서입니다.",
      },
    ],
    applications: [
      {
        title: "문서 이미지 정보 추출",
        description:
          "표나 양식의 필요한 정보를 구조화하고 원본과 비교하며 수정합니다.",
        effort: "1–2일 실험",
      },
      {
        title: "이미지 기반 리서치",
        description:
          "차트나 제품 화면을 질문의 맥락으로 사용하고 관찰과 추론을 분리해 답합니다.",
        effort: "프로토타입",
      },
    ],
    process: commonProcess,
  },
  {
    id: "local-llm",
    title: "로컬 LLM 기술 리서치",
    subtitle: "내 데이터와 인프라에서 시작하는 AI",
    summary:
      "로컬 모델을 선택할 때 확인해야 할 메모리, 응답 품질, 배포와 운영의 기준.",
    category: "Local LLM",
    date: "2025. 03. 07",
    image: assetPath("/images/chip.jpg"),
    readTime: "9분",
    tags: ["Local LLM", "Ollama", "양자화", "AI 인프라"],
    sections: [
      {
        title: "요약",
        body: "로컬 LLM은 데이터를 자체 환경에서 처리하고 추론 구성을 직접 관리할 수 있는 선택지입니다. 모든 작업에서 클라우드 API를 대체하기보다, 데이터 조건과 작업 특성에 맞춰 적용 범위를 정하는 편이 현실적입니다.",
      },
      {
        title: "핵심 변화",
        body: "모델 크기와 추론 도구의 선택 폭이 넓어지면서 작은 환경에서도 실험을 시작할 수 있습니다.",
        points: [
          "양자화는 메모리 사용량을 줄이지만 품질 영향도 함께 평가해야 합니다.",
          "모델 파라미터 외에 컨텍스트 길이와 동시 요청도 메모리에 영향을 줍니다.",
          "한국어 품질과 도구 호출은 사용 목적에 맞는 평가가 필요합니다.",
        ],
      },
      {
        title: "적용 가능성",
        body: "개인 문서 검색, 내부 문서 초안, 구조화된 정보 추출이 출발점이 될 수 있습니다. 문서 분할과 검색 품질을 먼저 개선한 뒤 모델 크기를 조절하면 병목을 구분하기 쉽습니다.",
      },
      {
        title: "운영 체크포인트",
        body: "모델 라이선스, 데이터 접근 권한, 응답 지연, 동시 사용량과 장비 비용을 확인합니다. 외부 API 호출 여부를 설정별로 검토하고, 민감 정보가 로그에 남지 않도록 관리합니다.",
      },
    ],
    sources: [
      {
        title: "Ollama 문서",
        publisher: "Ollama",
        url: "https://docs.ollama.com/",
        description: "로컬 모델 실행과 API 설정을 확인할 공식 문서입니다.",
      },
      {
        title: "llama.cpp",
        publisher: "ggml-org",
        url: "https://github.com/ggml-org/llama.cpp",
        description: "다양한 하드웨어의 모델 추론을 위한 공식 프로젝트입니다.",
      },
      {
        title: "Hugging Face 모델 허브",
        publisher: "Hugging Face",
        url: "https://huggingface.co/models",
        description: "모델 카드와 라이선스를 개별 확인하는 출발점입니다.",
      },
    ],
    applications: [
      {
        title: "개인 문서 검색",
        description:
          "파일을 로컬에서 인덱싱하고 답변에 해당 문서 위치를 함께 표시합니다.",
        effort: "프로토타입",
      },
      {
        title: "사내 문서 분류",
        description:
          "민감 정보가 포함된 문서의 분류 작업을 제한된 내부 환경에서 실험합니다.",
        effort: "서비스 검토",
      },
      {
        title: "장비별 추론 비교",
        description:
          "같은 프롬프트로 메모리 사용, 첫 응답 시간, 전체 처리 시간을 비교합니다.",
        effort: "1–2일 실험",
      },
    ],
    process: commonProcess,
  },
  {
    id: "rag-design",
    title: "신뢰할 수 있는 RAG 설계",
    subtitle: "답변의 품질은 검색부터 시작됩니다",
    summary:
      "문서 분할부터 검색 평가와 인용까지, 근거를 확인할 수 있는 검색형 AI를 설계합니다.",
    category: "RAG",
    date: "2025. 03. 06",
    image: assetPath("/images/network.jpg"),
    readTime: "7분",
    tags: ["RAG", "검색", "평가"],
    sections: [
      {
        title: "요약",
        body: "검색이 필요한 정보를 놓치면 언어 모델이 그 내용을 근거로 답할 수 없습니다. RAG의 문제를 검색, 맥락 구성, 답변 생성으로 나눠 확인해야 합니다.",
      },
      {
        title: "검색 품질",
        body: "문서의 제목과 구조를 보존하며 분할하고, 질문과 정답 문서 쌍으로 검색 결과를 평가합니다.",
        points: [
          "문서 갱신 시 인덱스를 함께 갱신합니다.",
          "검색된 문서에도 원본 접근 권한을 적용합니다.",
          "근거가 부족하면 답변을 보류하고 추가 정보를 요청합니다.",
        ],
      },
      {
        title: "검증 가능한 답변",
        body: "인용은 실제 검색 문서의 위치와 연결합니다. 출처가 있다는 사실과 출처가 주장을 뒷받침한다는 사실을 별도 평가합니다.",
      },
    ],
    sources: [
      {
        title: "Sentence Transformers 문서",
        publisher: "Sentence Transformers",
        url: "https://www.sbert.net/",
        description: "텍스트 임베딩과 검색 평가를 검토할 공식 문서입니다.",
      },
    ],
    applications: [
      {
        title: "출처를 보여주는 문서 도우미",
        description:
          "답변의 문장을 클릭하면 해당 원문 문단을 확인할 수 있게 구성합니다.",
        effort: "프로토타입",
      },
    ],
    process: commonProcess,
  },
  {
    id: "research-method",
    title: "AI 리서치를 프로젝트로 연결하는 법",
    subtitle: "읽고 끝내지 않는 기술 탐구",
    summary:
      "뉴스와 논문에서 발견한 질문을 작은 실험으로 바꾸고, 검증 가능한 결과를 남깁니다.",
    category: "연구 논문",
    date: "2025. 03. 05",
    image: assetPath("/images/earth.jpg"),
    readTime: "5분",
    tags: ["리서치", "프로젝트 아이디어", "실험 설계"],
    sections: [
      {
        title: "요약",
        body: "좋은 리서치는 수집한 링크의 수보다, 다음에 무엇을 확인해야 하는지 명확하게 만드는 데서 가치가 생깁니다.",
      },
      {
        title: "하나의 질문",
        body: "기술 소개를 읽고 지금 겪는 문제에 어떤 가설을 세울 수 있는지 적습니다. 가설이 맞았는지 판단할 기준을 정한 뒤 가장 작은 실험을 만듭니다.",
        points: [
          "문제와 대상 사용자를 한 문장으로 설명합니다.",
          "성공과 실패를 구분할 측정 기준을 정합니다.",
          "과정과 한계를 함께 기록해 다음 실험의 근거로 사용합니다.",
        ],
      },
      {
        title: "결과 남기기",
        body: "동작하는 작은 예시, 사용한 입력, 평가 기준, 남은 질문을 함께 보관합니다. 제한된 실험의 결과를 전체 기술의 성능으로 일반화하지 않습니다.",
      },
    ],
    sources: [
      {
        title: "arXiv 컴퓨터과학",
        publisher: "arXiv",
        url: "https://arxiv.org/archive/cs",
        description:
          "원문과 연구 한계를 직접 확인하기 위한 공개 논문 저장소입니다.",
      },
    ],
    applications: [
      {
        title: "일주일 리서치 노트",
        description: "매주 질문 하나, 실험 하나, 배운 점 하나를 기록합니다.",
        effort: "1주 실험",
      },
    ],
    process: commonProcess,
  },
];

export const researchItems = research;
export const getResearchById = (id: string) =>
  research.find((item) => item.id === id);
