/**
 * 🍚 공주님 오늘 저녁 자동 추천 봇 (v1.0)
 *
 * 매일 평일 18:00에 Slack #집밥 채널로 랜덤 3개 저녁 메뉴를 보내서
 * 투표형(이모지 반응)으로 선택하게 하는 Google Apps Script.
 *
 * 📥 설정 방법 (한번만):
 *   1) 새 Google Sheets 열기 → 확장 프로그램 → Apps Script
 *   2) 이 파일 전체 복사 → 코드 영역에 붙여넣기 → 저장
 *   3) 프로젝트 설정 → 스크립트 속성에 다음 추가:
 *      - SLACK_WEBHOOK_URL : 집밥 채널 Incoming Webhook URL
 *      - SLACK_BOT_TOKEN   : xoxb- 로 시작하는 봇 토큰 (반응 조회용, 선택)
 *      - SLACK_CHANNEL     : #집밥 (또는 채널 ID)
 *   4) 메뉴에서 🍚 레시피 → 1. 트리거 설치 클릭
 *   5) 테스트: 메뉴에서 🍚 레시피 → 2. 지금 추천 보내기
 *
 * 💡 레시피 추가는 깃허브 recipes.json 수정 or 메뉴 "URL로 추가하기"
 */

// ============================================================
// 설정
// ============================================================
const CONFIG = {
  RECIPES_URL: 'https://raw.githubusercontent.com/kwak8711/kwak8711.github.io/main/recipes/data/recipes.json',
  PICKER_URL: 'https://kwak8711.github.io/recipes/',
  LOG_SHEET_NAME: '선택로그',
  WEEKDAY_RECIPE_MAX_MIN: 30,  // 평일은 30분 이내 레시피 가중
  WEEKEND_ALLOW_LONG: true,     // 주말은 장시간 레시피 OK
};

// ============================================================
// onOpen - 커스텀 메뉴
// ============================================================
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🍚 레시피')
    .addItem('1. 트리거 설치 (매일 18:00)', 'installDailyTrigger')
    .addItem('2. 지금 추천 보내기 (테스트)', 'sendDailyPicks')
    .addItem('3. 레시피 목록 보기', 'listAllRecipes')
    .addSeparator()
    .addItem('4. 선택 로그 시트 생성', 'ensureLogSheet')
    .addItem('5. URL로 레시피 추가하기', 'promptAddRecipe')
    .addSeparator()
    .addItem('6. 모든 트리거 삭제', 'deleteAllTriggers')
    .addItem('7. 설정 확인', 'checkConfig')
    .addToUi();
}

// ============================================================
// 메인: 매일 추천 보내기
// ============================================================
function sendDailyPicks() {
  const recipes = fetchRecipes();
  if (!recipes || recipes.length === 0) {
    log_('⚠️ 레시피 로딩 실패');
    return;
  }

  const picks = pickRecipes_(recipes, 3);
  const message = buildSlackMessage_(picks);
  const result = sendSlack_(message);

  if (result.ok) {
    logPicks_(picks, result.ts);
    log_(`✅ 추천 발송 완료 - ${picks.map(p => p.name).join(', ')}`);
  } else {
    log_(`❌ 발송 실패: ${result.error}`);
  }
}

// ============================================================
// 레시피 불러오기 (GitHub raw JSON)
// ============================================================
function fetchRecipes() {
  try {
    const res = UrlFetchApp.fetch(CONFIG.RECIPES_URL, {
      muteHttpExceptions: true,
      followRedirects: true
    });
    if (res.getResponseCode() !== 200) {
      log_(`레시피 fetch 실패: HTTP ${res.getResponseCode()}`);
      return [];
    }
    const data = JSON.parse(res.getContentText());
    return data.recipes || [];
  } catch (e) {
    log_(`레시피 파싱 실패: ${e.message}`);
    return [];
  }
}

// ============================================================
// 레시피 선택 (요일·시간 가중치)
// ============================================================
function pickRecipes_(recipes, count) {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=일, 1=월, ...
  const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
  const month = now.getMonth() + 1;
  const isCold = month <= 3 || month >= 10;

  // 평일 → 30분 이내 선호
  // 쌀쌀한 달 → 찌개·국 가중
  let pool = recipes.slice();

  if (isWeekday) {
    pool = pool.filter(r => r.cook_time_min <= CONFIG.WEEKDAY_RECIPE_MAX_MIN);
    if (pool.length < count) pool = recipes.slice();
  }

  // 가중치 계산
  const weighted = pool.map(r => {
    let weight = 1;
    if (isCold && (r.tags || []).some(t => ['찌개','국','탕'].indexOf(t) !== -1)) weight *= 2;
    if (isWeekday && r.cook_time_min <= 20) weight *= 1.5;
    if ((r.weather_tags || []).indexOf(getWeatherTag_()) !== -1) weight *= 1.8;
    return { recipe: r, weight: weight };
  });

  // 가중치 랜덤 추출 (중복 없이)
  const picks = [];
  const used = {};
  while (picks.length < count && picks.length < pool.length) {
    const total = weighted.reduce((s, x) => used[x.recipe.id] ? s : s + x.weight, 0);
    let r = Math.random() * total;
    for (const w of weighted) {
      if (used[w.recipe.id]) continue;
      r -= w.weight;
      if (r <= 0) { picks.push(w.recipe); used[w.recipe.id] = true; break; }
    }
  }
  return picks;
}

function getWeatherTag_() {
  const month = new Date().getMonth() + 1;
  if (month <= 2 || month === 12) return '추운날';
  if (month <= 3 || month >= 10) return '쌀쌀한날';
  return '아무때나';
}

// ============================================================
// Slack 메시지 빌더 (Block Kit)
// ============================================================
function buildSlackMessage_(picks) {
  const today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy.MM.dd (E)');
  const emojis = ['1️⃣', '2️⃣', '3️⃣'];

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `🍚 오늘 저녁 뭐 먹지? · ${today}`, emoji: true }
    },
    { type: 'section', text: { type: 'mrkdwn', text: '*이모지로 투표하세요!* 👇' } },
    { type: 'divider' }
  ];

  picks.forEach((r, i) => {
    const cost = (r.cost_per_serving_krw || r.cost_krw || 0).toLocaleString();
    const stars = '★'.repeat(r.difficulty_level || 1) + '☆'.repeat(5 - (r.difficulty_level || 1));
    const tags = (r.tags || []).slice(0, 4).map(t => `\`#${t}\``).join(' ');
    const mainIngredients = (r.main_ingredients || []).join(', ');

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${emojis[i]} *<${r.url}|${r.name}>*\n⏱ ${r.cook_time_min}분 · 👥 ${r.servings}인분 · ${stars} · 💰 ₩${cost}/인\n🥘 _${mainIngredients}_\n${tags}`
      }
    });
  });

  blocks.push({ type: 'divider' });
  blocks.push({
    type: 'context',
    elements: [{
      type: 'mrkdwn',
      text: `🌐 <${CONFIG.PICKER_URL}|웹에서 전체 보기> · 🎲 다시 뽑으려면 \`/dinner\``
    }]
  });

  return {
    text: `오늘 저녁 추천: ${picks.map(p => p.name).join(' / ')}`,
    blocks: blocks
  };
}

// ============================================================
// Slack 발송
// ============================================================
function sendSlack_(payload) {
  const url = PropertiesService.getScriptProperties().getProperty('SLACK_WEBHOOK_URL');
  if (!url) return { ok: false, error: 'SLACK_WEBHOOK_URL 미설정' };

  try {
    const res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    const code = res.getResponseCode();
    if (code === 200) return { ok: true, ts: new Date().toISOString() };
    return { ok: false, error: `HTTP ${code}: ${res.getContentText()}` };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ============================================================
// 선택 로그 저장
// ============================================================
function logPicks_(picks, ts) {
  const sheet = ensureLogSheet();
  const today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
  picks.forEach((p, i) => {
    sheet.appendRow([
      today,
      i + 1,
      p.name,
      p.cook_time_min,
      p.servings,
      p.url,
      ts
    ]);
  });
}

function ensureLogSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.LOG_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.LOG_SHEET_NAME);
    sheet.appendRow(['날짜', '순번', '요리명', '시간(분)', '인분', 'URL', 'Slack TS']);
    sheet.getRange(1, 1, 1, 7)
      .setFontWeight('bold')
      .setBackground('#2d2d2d')
      .setFontColor('#ffffff');
    sheet.setFrozenRows(1);
    sheet.autoResizeColumns(1, 7);
  }
  return sheet;
}

// ============================================================
// 트리거 관리
// ============================================================
function installDailyTrigger() {
  deleteAllTriggers();
  ScriptApp.newTrigger('sendDailyPicks')
    .timeBased()
    .atHour(18)
    .everyDays(1)
    .inTimezone('Asia/Seoul')
    .create();
  SpreadsheetApp.getUi().alert('✅ 트리거 설치 완료\n매일 18:00에 자동 발송됩니다.');
}

function deleteAllTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => ScriptApp.deleteTrigger(t));
  if (triggers.length > 0) {
    log_(`🗑 ${triggers.length}개 트리거 삭제됨`);
  }
}

// ============================================================
// 설정·헬퍼
// ============================================================
function checkConfig() {
  const props = PropertiesService.getScriptProperties().getProperties();
  const triggers = ScriptApp.getProjectTriggers();
  const triggerInfo = triggers.map(t => `  - ${t.getHandlerFunction()}: ${t.getEventType()}`).join('\n') || '  (없음)';

  const msg =
    `📋 설정 확인\n\n` +
    `🔑 스크립트 속성:\n` +
    `  - SLACK_WEBHOOK_URL: ${props.SLACK_WEBHOOK_URL ? '✅ 설정됨' : '❌ 미설정'}\n` +
    `  - SLACK_CHANNEL: ${props.SLACK_CHANNEL || '(미설정)'}\n` +
    `  - SLACK_BOT_TOKEN: ${props.SLACK_BOT_TOKEN ? '✅ 설정됨' : '⚠️ 미설정 (선택사항)'}\n\n` +
    `⏰ 활성 트리거 (${triggers.length}개):\n${triggerInfo}\n\n` +
    `📡 레시피 소스: ${CONFIG.RECIPES_URL}`;
  SpreadsheetApp.getUi().alert(msg);
}

function listAllRecipes() {
  const recipes = fetchRecipes();
  if (!recipes || recipes.length === 0) {
    SpreadsheetApp.getUi().alert('레시피를 가져올 수 없습니다.');
    return;
  }
  const list = recipes.map((r, i) =>
    `${i + 1}. ${r.name} (${r.cook_time_min}분, ${r.servings}인분, ${'★'.repeat(r.difficulty_level)})`
  ).join('\n');
  SpreadsheetApp.getUi().alert(`📚 전체 레시피 (${recipes.length}개)\n\n${list}`);
}

function promptAddRecipe() {
  const ui = SpreadsheetApp.getUi();
  const resp = ui.prompt(
    '🔗 레시피 URL 추가',
    '만개의레시피 URL을 붙여넣으세요:\n(예: https://www.10000recipe.com/recipe/1234567)',
    ui.ButtonSet.OK_CANCEL
  );
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  const url = resp.getResponseText().trim();
  if (!/10000recipe\.com\/recipe\/\d+/.test(url)) {
    ui.alert('⚠️ 올바른 만개의레시피 URL이 아닙니다.');
    return;
  }
  ui.alert(
    '📝 수동 등록 안내',
    `자동 파싱은 다음 버전에서 지원됩니다.\n\n지금은:\n1) GitHub recipes.json 직접 수정\n2) 또는 Claude에게 URL 주고 "추가해줘" 요청\n\nURL이 복사되었습니다: ${url}`,
    ui.ButtonSet.OK
  );
}

function log_(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}
