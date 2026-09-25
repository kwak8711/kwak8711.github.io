# 오늘의 운세 카드 생성기

매일 아침 스케줄 세션이 이 폴더의 도구로 카드 이미지를 만들어 커밋하고,
Slack에는 그 이미지 URL을 보낸다. Slack이 직접 이미지 URL을 인라인으로
펼쳐주기 때문에 받는 쪽에서는 로그인도 클릭도 필요 없다.

## 매일 실행 순서

```bash
cd f/f9f35c4df7/_build

# 1. 오늘의 일진 (외부 검색 불필요, 60갑자를 직접 계산)
python3 ilju.py                     # 서울 기준 오늘

# 2. 오늘 내용을 day.json으로 작성 (sample-day.json을 형식 참고)

# 3. 카드 렌더링 → ../cards/YYYY-MM-DD.jpg
node render.mjs day.json

# 4. ../data/index.json 목록에 오늘 날짜 추가 후 커밋·푸시
```

이미지 URL: `https://kwak8711.github.io/f/f9f35c4df7/cards/YYYY-MM-DD.jpg`

## 파일

| 파일 | 역할 |
|---|---|
| `ilju.py` | 날짜 → 60갑자 일진 + 계수(癸水) 일간 기준 십성 |
| `render.mjs` | day.json + template.html → 카드 JPEG |
| `template.html` | 카드 레이아웃과 스타일 |
| `sample-day.json` | day.json 스키마 예시 (2026-09-25 기준) |
| `fonts/` | 주아체·고운돋움 (컨테이너에 한글 폰트가 없어 저장소에 포함) |

## 알아둘 것

- **오행 색** — 나무 `#63bb85` 불 `#c4443c` 흙 `#cf9226` 쇠 `#8b8fd6` 물 `#2f6fb5`.
  전통 오방색을 그대로 쓰면 물·쇠가 회색으로 읽혀 색각 검증에 실패하므로,
  계열은 유지하되 통과하는 단계로 조정한 값이다. 임의로 바꾸지 말 것.
- **playwright** — 컨테이너에 전역 설치되어 있고 `render.mjs`가 절대 경로로
  불러온다. 다른 위치라면 `PLAYWRIGHT_ENTRY` 환경변수로 지정한다.
- **Slack 캐시** — 같은 URL을 다시 보내면 이전 이미지가 뜰 수 있다.
  하루 안에 카드를 갱신해 다시 보낼 때는 URL 끝에 `?v=2`를 붙인다.
- **이 경로는 공개 저장소**다. 추측 불가능한 경로와 `robots.txt`로 가려두었지만
  URL을 아는 사람은 볼 수 있으니, 이름은 성을 뺀 '희은님'까지만 쓴다.
