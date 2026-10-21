# Lecture Companion

자막 강의를 보면서 평소 쓰는 AI에게 질문하고, 설명과 문답까지 복습 노트로 받는 스킬입니다.

**실험 버전 · Codex / Claude Code · Aside / ego · macOS / Linux**

[English](README.md) · [v0.10 다운로드](https://github.com/SundaePorkCutlet/lecture-companion/releases/tag/v0.10.0) · [노트 예시](examples/containers/notes.md) · [기술 문서](docs/reference.md)

## 시작하기

1. 스킬 설치기로 **[`skills/lecture-companion` 폴더](https://github.com/SundaePorkCutlet/lecture-companion/tree/main/skills/lecture-companion)**를 설치하거나, [독립 설치 ZIP](https://github.com/SundaePorkCutlet/lecture-companion/releases/download/v0.10.0/lecture-companion-0.10.0.zip)을 받아 아래 설치 명령을 실행합니다. 수집기와 실행 코드가 들어 있어 저장소 전체를 따로 유지할 필요가 없습니다.
2. Aside 또는 ego에서 강의를 열고 자막을 켭니다. 브라우저 로그인·프로필·CLI 연결을 먼저 마칩니다. 지원되는 호스트의 내장 런타임을 사용하므로 Node/npm을 따로 설치하지 않습니다.
3. Codex에 다음을 입력합니다. ego를 쓰면 문장의 Aside를 ego로 바꿉니다.

   > $lecture-companion으로 Aside 강의를 골라 같이 공부하고 질문 채팅도 열어줘. 질문과 답변은 최종 노트에 합쳐줘.

   Claude Code에서는 `/lecture-companion` 뒤에 같은 요청을 입력합니다.
4. 강의 제목을 고릅니다. 에이전트가 실제 자막·플레이어 이미지·질문 채팅 연결을 확인하면 재생합니다. 원래 보던 배속을 유지합니다.
5. 질문은 새 질문 채팅에서 합니다. 강의를 마치면 강의 처리 채팅에 **“수집을 멈추고 최종 학습 노트를 만들어줘”**라고 요청합니다.

릴리스 ZIP을 직접 받았다면 압축을 푼 뒤 한 번 실행합니다. 일반 스킬 설치기를 썼다면 생략합니다.

```sh
/bin/sh lecture-companion/scripts/install.sh
# Claude Code: 뒤에 --host claude-code
# 둘 다: 뒤에 --host both
```

스킬이 안 보이면 새 채팅을 열거나 설치된 `SKILL.md`를 읽어 달라고 요청하세요. 설치 후 다운로드 폴더는 지워도 됩니다. 사용자 수정본이 있으면 설치기가 보존합니다.

## 내 강의 없이 체험하기

> $lecture-companion의 내장 샘플을 Aside에서 열고 질문 채팅까지 준비해서 같이 공부하자. 마지막에는 문답을 포함한 노트를 만들어줘.

직접 만든 **36초짜리 무음 강의**가 포함되어 있습니다. 이미지와 컨테이너의 차이를 설명하며, 실제 강의와 같은 수집·질문 경로를 사용합니다. 에이전트가 로컬 데모 서버를 띄우고 브라우저를 연결합니다. 준비가 끝나면 재생하세요.

질문 예시: **“docker cp로 복사하면 다음 컨테이너가 사용할 이미지도 바뀌어?”**

[최종 노트 예시](examples/containers/notes.md)는 읽기 형태를 보여주는 가상 예시입니다. 실제 사용자의 질문 기록이나 외부 강의 자료를 포함하지 않습니다.

## 알아둘 점

- Aside는 제목 선택부터 안내하고, ego는 에이전트가 브라우저 스킬로 선택합니다. 일반 Chrome 직접 연결은 아직 지원하지 않습니다.
- Codex의 지원되는 도구에서는 질문 채팅을 자동으로 엽니다. Claude Code 등에서 자동 열기 도구가 없으면 파일 도구를 쓸 수 있는 별도 세션을 여는 단계가 필요합니다.
- 질문마다 최신 수집 문맥을 읽습니다. 수집이 끝난 뒤에도 기존 세션으로 질문할 수 있고, 나중에 저장된 문답은 다시 내보내야 노트에 반영됩니다.
- 재생 종료를 직접 관찰하면 정상 완료합니다. 플레이어·소스 변경을 감지하면 현재 세션을 멈추고 다음 강의를 고르도록 안내합니다. 다음 강의로 자동 이동하지 않습니다.
- 화면 자막만 수집하며 음성 인식은 없습니다. 접근할 수 없는 iframe은 호환 모드로 읽고, 영상에 그려진 자막만 있는 경우는 지원하지 않습니다. 완전한 녹취를 보장하지 않습니다.
- 수집기는 모델을 호출하지 않습니다. 설명과 질문 답변에는 사용하는 AI 호스트의 사용량·과금 체계가 적용됩니다. 토큰 절감량은 측정하지 않았습니다.

기록은 기본적으로 `~/.local/share/lecture-companion/sessions/`에 저장됩니다. 선택한 근거를 AI 호스트가 읽으며 해당 호스트의 데이터 처리 설정이 적용됩니다. 처음 로그인하고 브라우저를 연결하는 시간은 별도라, 모든 환경에서 5분 시작을 보장하지 않습니다.

문제가 생기면 브라우저·AI 호스트·버전과 막힌 단계를 알려주세요. [기여 안내](CONTRIBUTING.md) · [자세한 명령과 검증 기록](docs/reference.md)
