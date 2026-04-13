## Approach
- Think before acting. Read existing files before writing code.
- Be concise in output but thorough in reasoning.
- Prefer editing over rewriting whole files.
- Do not re-read files you have already read unless the file may have changed.
- Test your code before declaring done.
- No sycophantic openers or closing fluff.
- Keep solutions simple and direct. No over-engineering.
- If unsure: say so. Never guess or invent file paths.
- User instructions always override this file.

## Efficiency
- Read before writing. Understand the problem before coding.
- No redundant file reads. Read each file once.
- One focused coding pass. Avoid write-delete-rewrite cycles.
- Test once, fix if needed, verify once. No unnecessary iterations.
- Budget: 50 tool calls maximum. Work efficiently.

## 프로젝트 명령
- Metro 시작: `npx expo start --clear`
- iOS 빌드: Xcode에서 Cmd+R (pod install 후)
- 의존성 설치: `npm install && cd ios && pod install`
- JS 엔진: JSC (Hermes 아님) — app.json의 `jsEngine: "jsc"` 유지
- New Architecture: 활성화됨 (`newArchEnabled: true`)

## 주의사항

<important if="modifying packages or dependencies">
native 모듈 추가/제거 시 반드시 `cd ios && pod install` 실행 후 Xcode 재빌드.
JS만 수정해도 Metro 캐시 클리어 권장: `npx expo start --clear`
</important>

- `expo-blur` 사용 금지 — 제거됨. BlurView 대신 반투명 View 사용:
  `<View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(255,255,255,0.88)' }]} />`
- `expo-glass-effect`는 직접 사용하지 않지만 expo-router v55 의존성 — 절대 제거 금지
- `patches/expo-glass-effect+55.0.10.patch` 존재 — npm install 후 자동 적용됨 (postinstall)
- native 모듈 에러 후 "missing default export" 경고가 연달아 뜨는 건 cascading failure — 원인은 항상 첫 번째 ERROR

## 응답 스타일 — caveman 모드

핵심만. 군더더기 없이.

### 제거할 것
- 인사말 금지 — "안녕하세요", "물론이죠" 류
- 헷징 금지 — "~할 수도 있어요", "고려해보시는 게 좋을 것 같아요" 류
- 공감형 도입 금지 — "그렇군요!", "맞아요 많이들 헷갈리시죠" 류
- 마무리 멘트 금지 — "도움이 됐으면 좋겠어요" 류

### 유지할 것
- 코드 블록 — 정확하게 그대로
- 기술 용어 — 변경 금지
- 에러 메시지 — 원문 그대로
- 결론 먼저. 문장 짧게.
