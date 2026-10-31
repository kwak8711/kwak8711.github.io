/**
 * 🍚 공주님 오늘 저녁 자동 추천 봇 v2.0 (스레드 + 액션 버튼 + 다시뽑기)
 *
 * v2 신규 기능:
 *   - 각 레시피 카드에 액션 버튼 3개 (📖 레시피 보기 / 💬 댓글 / 🌐 웹)
 *   - 🎲 다시 뽑기 버튼 (웹 피커로 즉시 이동)
 *   - 자동 스레드 작성 (Bot Token 있을 때)
 *   - 선택 로그 Sheets 자동 저장
 *   - 요일·날씨 가중치 선택
 *
 * 📥 설정 방법:
 *   1) 새 Google Sheets 열기 → 확장 프로그램 → Apps Script
 *   2) 이 파일 전체 복사 → 저장
 *   3) 프로젝트 설정 → 스크립트 속성:
 *      - SLACK_WEBHOOK_URL: Incoming Webhook URL (필수)
 *      - SLACK_BOT_TOKEN: xoxb- 토큰 (선택, 있으면 스레드 사용)
 *      - SLACK_CHANNEL: #집밥 또는 채널 ID
 *   4) 메뉴 "🍚 레시피 → 1. 트리거 설치" 클릭
 */

// ============================================================
// 설정
// ============================================================
const CONFIG = {
  RECIPES_URL: 'https://raw.githubusercontent.com/kwak8711/kwak8711.github.io/main/recipes/data/recipes.json',
  PICKER_URL: 'https://kwak8711.github.io/recipes/',
  LOG_SHEET_NAME: '선택로그',
  WEEKDAY_RECIPE_MAX_MIN: 30,
  WEEKEND_ALLOW_LONG: true,
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
    .addItem('8. Webhook 재테스트', 'testWebhook')
    .addToUi();
}

// ============================================================
// 메인: 매일 추천 보내기 (v2: 스레드 + 버튼)
// ============================================================
function sendDailyPicks() {
  const recipes = fetchRecipes();
  if (!recipes || recipes.length === 0) {
    log_('⚠️ 레시피 로딩 실패');
    return;
  }

  const picks = pickRecipes_(recipes, 3);
  const result = sendMainMessage_(picks, recipes.length);

  if (result.ok) {
    logPicks_(picks, result.ts);
    // 스레드 댓글 자동 작성 (Bot Token 있을 때)
    if (result.ts) {
      sendThreadReply_(result.ts, '💬 투표 또는 코멘트는 여기에 남겨주세요!\n선택 완료되면 👆 "레시피 보기" 눌러서 재료·조리순서 확인하세요.');
    }
    log_(`✅ 추천 발송 완료 - ${picks.map(p => p.name).join(', ')}`);
  } else {
    log_(`❌ 발송 실패: ${result.error}`);
  }
}

// ============================================================
// 레시피 불러오기
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
// 레시피 선택 (요일·날씨 가중치)
// ============================================================
function pickRecipes_(recipes, count) {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
  const month = now.getMonth() + 1;
  const isCold = month <= 3 || month >= 10;

  let pool = recipes.slice();
  if (isWeekday) {
    const quickPool = pool.filter(r => r.cook_time_min <= CONFIG.WEEKDAY_RECIPE_MAX_MIN);
    if (quickPool.length >= count) pool = quickPool;
  }

  const weighted = pool.map(r => {
    let weight = 1;
    const tags = r.tags || [];
    if (isCold && (tags.indexOf('찌개') !== -1 || tags.indexOf('국') !== -1 || tags.indexOf('탕') !== -1)) weight *= 2;
    if (isWeekday && r.cook_time_min <= 20) weight *= 1.5;
    const weatherTag = getWeatherTag_();
    if ((r.weather_tags || []).indexOf(weatherTag) !== -1) weight *= 1.8;
    return { recipe: r, weight: weight };
  });

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
// 메인 메시지 (액션 버튼 + 블록킷)
// ============================================================
function sendMainMessage_(picks, totalRecipeCount) {
  const today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy.MM.dd (E)');
  const emojis = ['1️⃣', '2️⃣', '3️⃣'];
  const totalCount = totalRecipeCount || picks.length;

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `🍚 공주님 오늘 저녁 뭐 먹지? · ${today}`, emoji: true }
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*이모지로 투표 or 아래 버튼으로 선택하세요!* 👇\n_(랜덤 추천 · 요일·날씨 가중치 적용)_'
      }
    },
    { type: 'divider' }
  ];

  picks.forEach((r, i) => {
    const cost = (r.cost_per_serving_krw || r.cost_krw || 0).toLocaleString();
    const stars = '★'.repeat(r.difficulty_level || 1) + '☆'.repeat(5 - (r.difficulty_level || 1));
    const tags = (r.tags || []).slice(0, 4).map(t => `\`#${t}\``).join(' ');
    const mainIngredients = (r.main_ingredients || []).join(', ');

    const kcal = r.kcal_per_serving || '?';
    const kcalEmoji = kcal === '?' ? '🔥' : (kcal < 200 ? '🟢' : kcal < 400 ? '🟡' : kcal < 600 ? '🟠' : '🔴');
    // 레시피 상세 섹션
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${emojis[i]} *${r.name}*\n⏱ ${r.cook_time_min}분 · 👥 ${r.servings}인분 · ${stars}\n${kcalEmoji} *${kcal}kcal*/인 · 💰 ₩${cost}/인\n🥘 _${mainIngredients}_\n${tags}`
      }
    });

    // 액션 버튼 3개 (URL 버튼 - Webhook 호환!)
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '📖 레시피 보기', emoji: true },
          url: r.url,
          style: 'primary'
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '🌐 웹에서 보기', emoji: true },
          url: `${CONFIG.PICKER_URL}#${r.id}`
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '💬 선택하기', emoji: true },
          url: `${CONFIG.PICKER_URL}?select=${r.id}`
        }
      ]
    });

    if (i < picks.length - 1) blocks.push({ type: 'divider' });
  });

  // 다시 뽑기 섹션
  blocks.push({ type: 'divider' });
  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: '*🎲 다른 메뉴가 궁금하다면?*'
    }
  });
  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: { type: 'plain_text', text: '🎲 다시 뽑기', emoji: true },
        url: `${CONFIG.PICKER_URL}?reshuffle=1`,
        style: 'danger'
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: '📚 전체 레시피', emoji: true },
        url: CONFIG.PICKER_URL
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: '⚡ 5분 요리만', emoji: true },
        url: `${CONFIG.PICKER_URL}?filter=quick`
      }
    ]
  });

  blocks.push({ type: 'divider' });
  blocks.push({
    type: 'context',
    elements: [{
      type: 'mrkdwn',
      text: `✨ Claude 자동화 봇 · ${totalCount}개 레시피 · 💬 스레드에 댓글 환영`
    }]
  });

  const payload = {
    text: `🍚 오늘 저녁 추천: ${picks.map(p => p.name).join(' / ')}`,
    blocks: blocks
  };

  return sendSlack_(payload);
}

// ============================================================
// Slack 발송 (Webhook 또는 Bot Token)
// ============================================================
function sendSlack_(payload) {
  const token = PropertiesService.getScriptProperties().getProperty('SLACK_BOT_TOKEN');
  const channel = PropertiesService.getScriptProperties().getProperty('SLACK_CHANNEL') || '#집밥';

  // Bot Token 있으면 chat.postMessage (스레드 ts 반환)
  if (token && token.indexOf('xoxb-') === 0) {
    try {
      payload.channel = channel;
      const res = UrlFetchApp.fetch('https://slack.com/api/chat.postMessage', {
        method: 'post',
        contentType: 'application/json; charset=utf-8',
        headers: { 'Authorization': 'Bearer ' + token },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      });
      const result = JSON.parse(res.getContentText());
      if (result.ok) return { ok: true, ts: result.ts };
      return { ok: false, error: result.error };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // Fallback: Incoming Webhook
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
    if (code === 200) return { ok: true, ts: null };
    return { ok: false, error: `HTTP ${code}: ${res.getContentText()}` };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ============================================================
// 스레드 댓글 (Bot Token 전용)
// ============================================================
function sendThreadReply_(threadTs, text) {
  const token = PropertiesService.getScriptProperties().getProperty('SLACK_BOT_TOKEN');
  const channel = PropertiesService.getScriptProperties().getProperty('SLACK_CHANNEL') || '#집밥';

  if (!token || token.indexOf('xoxb-') !== 0) return;

  try {
    UrlFetchApp.fetch('https://slack.com/api/chat.postMessage', {
      method: 'post',
      contentType: 'application/json; charset=utf-8',
      headers: { 'Authorization': 'Bearer ' + token },
      payload: JSON.stringify({
        channel: channel,
        thread_ts: threadTs,
        text: text
      }),
      muteHttpExceptions: true
    });
  } catch (e) {
    log_('스레드 발송 실패: ' + e.message);
  }
}

// ============================================================
// 로그
// ============================================================
function logPicks_(picks, ts) {
  const sheet = ensureLogSheet();
  const today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
  picks.forEach((p, i) => {
    sheet.appendRow([
      today, i + 1, p.name, p.cook_time_min, p.servings,
      p.url, ts || new Date().toISOString()
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
  if (triggers.length > 0) log_(`🗑 ${triggers.length}개 트리거 삭제됨`);
}

// ============================================================
// Webhook 테스트
// ============================================================
function testWebhook() {
  const ui = SpreadsheetApp.getUi();
  const testPayload = {
    text: '🧪 Webhook 테스트',
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*✅ Webhook 연결 확인*\n\n이 메시지가 보이면 봇이 정상 작동 중입니다.'
        }
      },
      {
        type: 'actions',
        elements: [{
          type: 'button',
          text: { type: 'plain_text', text: '🎲 지금 저녁 추천 받기', emoji: true },
          url: 'https://kwak8711.github.io/recipes/',
          style: 'primary'
        }]
      }
    ]
  };
  const result = sendSlack_(testPayload);
  if (result.ok) {
    ui.alert('✅ 테스트 성공!', 'Slack 채널 확인하세요.', ui.ButtonSet.OK);
  } else {
    ui.alert('❌ 테스트 실패', result.error, ui.ButtonSet.OK);
  }
}

// ============================================================
// 설정·헬퍼
// ============================================================
function checkConfig() {
  const props = PropertiesService.getScriptProperties().getProperties();
  const triggers = ScriptApp.getProjectTriggers();
  const triggerInfo = triggers.map(t => `  - ${t.getHandlerFunction()}: ${t.getEventType()}`).join('\n') || '  (없음)';
  const hasBot = props.SLACK_BOT_TOKEN && props.SLACK_BOT_TOKEN.indexOf('xoxb-') === 0;

  const msg =
    `📋 설정 확인 (v2.0)\n\n` +
    `🔑 스크립트 속성:\n` +
    `  - SLACK_WEBHOOK_URL: ${props.SLACK_WEBHOOK_URL ? '✅ 설정됨' : '❌ 미설정'}\n` +
    `  - SLACK_CHANNEL: ${props.SLACK_CHANNEL || '(기본값 #집밥)'}\n` +
    `  - SLACK_BOT_TOKEN: ${hasBot ? '✅ 설정됨 (스레드 기능 활성)' : '⚠️ 미설정 (스레드 비활성)'}\n\n` +
    `⏰ 활성 트리거 (${triggers.length}개):\n${triggerInfo}\n\n` +
    `📡 레시피 소스:\n${CONFIG.RECIPES_URL}\n\n` +
    `🌐 웹 피커:\n${CONFIG.PICKER_URL}\n\n` +
    `💡 Bot Token 추가하면 자동 스레드 댓글 활성화됩니다.\n` +
    `발급: api.slack.com/apps → OAuth & Permissions → Bot Token Scopes에 chat:write 추가`;
  SpreadsheetApp.getUi().alert(msg);
}

function listAllRecipes() {
  const recipes = fetchRecipes();
  if (!recipes || recipes.length === 0) {
    SpreadsheetApp.getUi().alert('레시피를 가져올 수 없습니다.');
    return;
  }
  // Group by category
  const byCat = {};
  recipes.forEach(r => {
    if (!byCat[r.category]) byCat[r.category] = [];
    byCat[r.category].push(r);
  });
  const list = Object.keys(byCat).map(cat => {
    return `[${cat}] ${byCat[cat].length}개\n` +
      byCat[cat].map(r => `  - ${r.name} (${r.cook_time_min}분)`).join('\n');
  }).join('\n\n');
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
    `자동 파싱은 다음 버전에서 지원됩니다.\n\n지금은 Claude에게 URL 주고 "레시피 DB에 추가해줘" 요청:\n\n${url}`,
    ui.ButtonSet.OK
  );
}

function log_(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}
