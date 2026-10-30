# 🤖 Slack 매일 저녁 추천 봇 세팅 가이드 (3분 완성)

## 📋 전체 흐름

```
[Google Sheets] → [Apps Script 코드 복붙] → [Slack Webhook URL 설정] → [트리거 설치] → [매일 18:00 자동 발송]
```

## 🚀 1단계: Slack Incoming Webhook URL 발급 (1분)

### 방법 A: Slack 앱에서 (가장 간단)

1. 👉 https://api.slack.com/apps 접속
2. **Create New App** 클릭
3. **From scratch** 선택
4. App Name: `집밥 추천봇`, Workspace: 공주님 워크스페이스 선택
5. 좌측 메뉴 **Incoming Webhooks** 클릭
6. 토글 **On** 전환
7. 하단 **Add New Webhook to Workspace** 클릭
8. 채널 선택 (예: `#집밥` 또는 새로 생성 `#집밥-추천`)
9. **Allow** 클릭
10. 생성된 URL 복사 📋 (형식: `https://hooks.slack.com/services/T.../B.../...`)

### 방법 B: 기존 Webhook 재사용

이미 KB SMS Bridge나 다른 봇에서 쓰는 Webhook URL이 있으면:
- 같은 채널로 보내려면 → 그 URL 그대로 사용
- 다른 채널로 보내려면 → 방법 A로 새로 발급

## 🔧 2단계: Google Apps Script 세팅 (2분)

### 2-1. 새 Google Sheets 생성
1. https://sheets.google.com → **+ 빈 스프레드시트** 클릭
2. 제목 변경: `공주님 저녁 추천 로그`

### 2-2. Apps Script 열기
1. 상단 메뉴 → **확장 프로그램** → **Apps Script**
2. 새 탭에서 Apps Script 편집기 열림

### 2-3. 코드 붙여넣기
1. 👉 https://raw.githubusercontent.com/kwak8711/kwak8711.github.io/main/recipes/apps-script/daily-picker.gs 접속
2. 전체 복사 (Ctrl+A → Ctrl+C)
3. Apps Script 편집기의 기본 `Code.gs` 내용 전부 삭제
4. 복사한 코드 붙여넣기 (Ctrl+V)
5. 💾 **저장** (Ctrl+S)
6. 프로젝트 이름 입력: `공주님 저녁 추천봇`

### 2-4. Webhook URL 설정
1. 왼쪽 메뉴 ⚙️ **프로젝트 설정** 클릭
2. 하단 **스크립트 속성** → **스크립트 속성 추가**
3. 다음 2개 추가:

| 속성 이름 | 값 |
|---|---|
| `SLACK_WEBHOOK_URL` | 1단계에서 복사한 Webhook URL |
| `SLACK_CHANNEL` | `#집밥` (또는 원하는 채널명) |

4. **스크립트 속성 저장** 클릭

### 2-5. 권한 승인
1. 상단 함수 선택 드롭다운 → `sendDailyPicks` 선택
2. ▶️ **실행** 클릭
3. 권한 요청 창 뜨면:
   - **권한 검토** → 본인 Google 계정 선택
   - "확인되지 않은 앱" 경고 뜨면 → **고급** → **공주님 저녁 추천봇(안전하지 않음)으로 이동**
   - **허용** 클릭
4. Slack 채널에서 ✅ 테스트 메시지 확인!

## ⏰ 3단계: 자동 트리거 설치 (10초)

### 3-1. 시트로 돌아가기
1. Apps Script 편집기 닫기
2. Google Sheets 탭으로 이동 → 🔄 **새로고침**

### 3-2. 메뉴에서 트리거 설치
1. 상단 메뉴 **🍚 레시피** 보이는지 확인
2. **🍚 레시피** → **1. 트리거 설치 (매일 18:00)** 클릭
3. ✅ "트리거 설치 완료" 알림 확인

### 3-3. 설정 확인
1. **🍚 레시피** → **7. 설정 확인** 클릭
2. 다음 모두 ✅ 인지 확인:
   - SLACK_WEBHOOK_URL: ✅ 설정됨
   - 활성 트리거: 1개 (sendDailyPicks)

## 🎯 완성! 이제 매일 18:00에 자동 발송됩니다

Slack 메시지는 이렇게 생겼어요:

```
🍚 오늘 저녁 뭐 먹지? · 2026.10.31 (토)
━━━━━━━━━━━━━━━━━━━━━━━━
이모지로 투표하세요! 👇
━━━━━━━━━━━━━━━━━━━━━━━━
1️⃣ 백종원 제육볶음
⏱ 30분 · 👥 6인분 · ★★☆☆☆ · 💰 ₩2,500/인
🥘 돼지 앞다리살, 양파, 양송이, 청양고추
#제육볶음 #돼지고기 #매운맛 #밥도둑

2️⃣ 차돌박이 된장찌개
⏱ 30분 · 👥 2인분 · ★★★☆☆ · 💰 ₩6,000/인
🥘 차돌박이, 두부, 애호박, 양파
#찌개 #된장 #집밥 #쌀쌀한날

3️⃣ 5분 간장계란밥
⏱ 5분 · 👥 1인분 · ★☆☆☆☆ · 💰 ₩1,500/인
🥘 밥, 계란, 간장, 참기름
#5분요리 #간장계란밥 #자취생 #혼밥
━━━━━━━━━━━━━━━━━━━━━━━━
🌐 웹에서 전체 보기 · 🎲 /dinner
```

## 📱 사용법

### 매일 자동 발송 (평일 18:00)
- 자동으로 Slack 채널에 추천 메시지 발송
- 1️⃣ 2️⃣ 3️⃣ 이모지로 투표
- 선택 로그는 `선택로그` 시트에 자동 저장

### 수동 실행 (지금 바로)
`🍚 레시피` → `2. 지금 추천 보내기 (테스트)`

### 전체 레시피 조회
`🍚 레시피` → `3. 레시피 목록 보기`

### 새 레시피 추가
`🍚 레시피` → `5. URL로 레시피 추가하기`

## 🔥 추가 커스터마이징

### 발송 시간 변경 (예: 저녁 7시로)
Apps Script 코드의 `installDailyTrigger` 함수에서:
```
.atHour(18)   →   .atHour(19)   (저녁 7시)
```

### 추천 개수 변경 (3개 → 5개)
`sendDailyPicks` 함수의:
```
const picks = pickRecipes_(recipes, 3);   →   pickRecipes_(recipes, 5);
```

### 주말만 발송
`installDailyTrigger` 함수의 `.everyDays(1)` 대신:
```
.onWeekDay(ScriptApp.WeekDay.SATURDAY)
```

## 🆘 문제 해결

### "스크립트 속성이 미설정" 알림이 뜰 때
→ 2-4단계 Webhook URL 설정 다시 확인

### Slack에 메시지가 안 올 때
1. `🍚 레시피` → `7. 설정 확인`으로 Webhook URL 확인
2. Slack 앱 설정에서 Incoming Webhook 활성화 확인
3. Webhook URL이 선택한 채널에 연결되어 있는지 확인

### 트리거가 작동 안 할 때
`🍚 레시피` → `6. 모든 트리거 삭제` → `1. 트리거 설치` 재실행

### 레시피가 로딩 안 될 때
- GitHub Pages 캐시 문제일 수 있음 (최대 10분 대기)
- recipes.json URL 직접 확인:
  https://raw.githubusercontent.com/kwak8711/kwak8711.github.io/main/recipes/data/recipes.json

## 📊 선택로그 시트

`선택로그` 시트에 매일 추천된 메뉴가 자동 저장됩니다:

| 날짜 | 순번 | 요리명 | 시간(분) | 인분 | URL | Slack TS |
|---|---|---|---|---|---|---|
| 2026-10-31 | 1 | 백종원 제육볶음 | 30 | 6 | ... | ... |
| 2026-10-31 | 2 | 차돌 된장찌개 | 30 | 2 | ... | ... |
| 2026-10-31 | 3 | 간장계란밥 | 5 | 1 | ... | ... |

이 로그로 월말 통계·반복 선호도 분석 가능!
