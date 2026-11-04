/**
 * 🍚 공주님 오늘 저녁 자동 추천 봇 v3.0 (초간결 추천형)
 *
 * v3 신규:
 *   - 메시지 70% 짧아짐 (스크롤 안 해도 한눈에)
 *   - "재료 뭐있으니 ~ 어떠세요?" 추천형 문구
 *   - pantry 매칭 TOP1 레시피 1개만 메인으로 제안
 *   - 하단에 "다른 2개 메뉴" 작게 노출
 *   - 모든 상세는 웹페이지로 유도 (🌐 웹에서 자세히)
 *
 * 📥 설정:
 *   - SLACK_WEBHOOK_URL: 필수
 *   - SLACK_BOT_TOKEN: 선택 (스레드 기능)
 *   - SLACK_CHANNEL: #집밥
 */

const CONFIG = {
  RECIPES_URL: 'https://raw.githubusercontent.com/kwak8711/kwak8711.github.io/main/recipes/data/recipes.json',
  PANTRY_URL: 'https://raw.githubusercontent.com/kwak8711/kwak8711.github.io/main/recipes/data/pantry.json',
  PICKER_URL: 'https://kwak8711.github.io/recipes/',
  LOG_SHEET_NAME: '선택로그',
  WEEKDAY_RECIPE_MAX_MIN: 30,
};

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

function sendDailyPicks() {
  const recipes = fetchRecipes();
  const pantry = fetchPantry();
  if (!recipes || recipes.length === 0) { log_('⚠️ 레시피 로딩 실패'); return; }

  const picks = pickWithPantry_(recipes, pantry, 3);
  const result = sendMainMessage_(picks, pantry);

  if (result.ok) {
    logPicks_(picks, result.ts);
    if (result.ts) {
      sendThreadReply_(result.ts, '💬 투표나 코멘트 환영!\n🌐 더 많은 메뉴는 웹에서 → ' + CONFIG.PICKER_URL);
    }
    log_(`✅ 발송 - ${picks.map(p => p.name).join(', ')}`);
  } else {
    log_(`❌ 실패: ${result.error}`);
  }
}

function fetchRecipes() {
  try {
    const res = UrlFetchApp.fetch(CONFIG.RECIPES_URL, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return [];
    return JSON.parse(res.getContentText()).recipes || [];
  } catch (e) { log_('레시피 실패: ' + e.message); return []; }
}

function fetchPantry() {
  try {
    const res = UrlFetchApp.fetch(CONFIG.PANTRY_URL, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return { ingredients: [], match_aliases: {} };
    return JSON.parse(res.getContentText());
  } catch (e) { return { ingredients: [], match_aliases: {} }; }
}

// pantry 재료와 매칭 점수 계산
function matchPantry_(recipe, pantry) {
  if (!pantry.ingredients || pantry.ingredients.length === 0) return { count: 0, matched: [] };
  const names = pantry.ingredients.map(i => i.name);
  const aliases = pantry.match_aliases || {};
  const ings = (recipe.main_ingredients || []).concat(
    (recipe.ingredients || []).map(x => x.name || '')
  );
  const matched = [];
  for (const p of names) {
    const alts = aliases[p] || [p];
    for (const ri of ings) {
      if (alts.some(a => ri.indexOf(a) > -1 || a.indexOf(ri) > -1)) {
        matched.push(p);
        break;
      }
    }
  }
  return { count: matched.length, matched: matched };
}

// pantry 우선 + 요일/날씨 가중치
function pickWithPantry_(recipes, pantry, count) {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
  const month = now.getMonth() + 1;
  const isCold = month <= 3 || month >= 10;

  // 매칭 점수 계산
  const scored = recipes.map(r => {
    const m = matchPantry_(r, pantry);
    let weight = 1 + (m.count * 2); // pantry 매칭이 가장 큰 가중치
    const tags = r.tags || [];
    if (isWeekday && r.cook_time_min <= 30) weight *= 1.3;
    if (isCold && (tags.indexOf('찌개') > -1 || tags.indexOf('국') > -1)) weight *= 1.5;
    return { recipe: r, weight: weight, match: m };
  });

  // 가중치 랜덤 선택 (중복 없이)
  const picks = [];
  const used = {};
  while (picks.length < count && picks.length < scored.length) {
    const total = scored.reduce((s, x) => used[x.recipe.id] ? s : s + x.weight, 0);
    let r = Math.random() * total;
    for (const w of scored) {
      if (used[w.recipe.id]) continue;
      r -= w.weight;
      if (r <= 0) {
        picks.push({ ...w.recipe, _match: w.match });
        used[w.recipe.id] = true;
        break;
      }
    }
  }
  return picks;
}

// ============================================================
// v3.0 짧은 추천형 메시지
// ============================================================
function sendMainMessage_(picks, pantry) {
  const today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'M월 d일 (E)');
  const main = picks[0];
  const others = picks.slice(1);

  // pantry 재료 요약 (매칭된 것 우선)
  const matched = main._match && main._match.matched ? main._match.matched.slice(0, 4) : [];
  const pantryHint = matched.length > 0
    ? `냉장고에 *${matched.join(', ')}* 있으니까`
    : `오늘 저녁 메뉴 추천`;

  const kcal = main.kcal_per_serving || '?';
  const kcalEmoji = kcal === '?' ? '🔥' : (kcal < 300 ? '🟢' : kcal < 500 ? '🟡' : kcal < 700 ? '🟠' : '🔴');
  const cost = (main.cost_per_serving_krw || main.cost_krw || 0).toLocaleString();

  const blocks = [
    // 추천 헤더
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `👑 *${today}, 오늘 저녁*\n${pantryHint}\n\n🍽️ *${main.name}* 어떠세요?`
      }
    },
    // 메인 정보 한 줄
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `⏱ ${main.cook_time_min}분 · ${kcalEmoji} ${kcal}kcal · 💰 ₩${cost}/인`
      }
    },
    // 액션 버튼 (레시피 + 웹)
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '📖 레시피 보기', emoji: true },
          url: main.url,
          style: 'primary'
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '🌐 다른 메뉴 보기', emoji: true },
          url: CONFIG.PICKER_URL + '?filter=pantry'
        }
      ]
    }
  ];

  // 다른 2개 간단히
  if (others.length > 0) {
    const othersText = others.map((r, i) => {
      const k = r.kcal_per_serving || '?';
      return `${i+2}. *${r.name}* _(${r.cook_time_min}분·${k}kcal)_`;
    }).join('\n');
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*🎲 다른 추천:*\n${othersText}` }
    });
  }

  // 하단 - 웹 보러가기 (깔끔)
  blocks.push({
    type: 'context',
    elements: [{
      type: 'mrkdwn',
      text: `🌐 <${CONFIG.PICKER_URL}|웹에서 53개 메뉴 전체 보기> · 🏠 pantry 기반 추천`
    }]
  });

  return sendSlack_({
    text: `🍽️ 오늘 저녁: ${main.name}`,
    blocks: blocks
  });
}

function sendSlack_(payload) {
  const token = PropertiesService.getScriptProperties().getProperty('SLACK_BOT_TOKEN');
  const channel = PropertiesService.getScriptProperties().getProperty('SLACK_CHANNEL') || '#집밥';

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
    } catch (e) { return { ok: false, error: e.message }; }
  }

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
  } catch (e) { return { ok: false, error: e.message }; }
}

function sendThreadReply_(threadTs, text) {
  const token = PropertiesService.getScriptProperties().getProperty('SLACK_BOT_TOKEN');
  const channel = PropertiesService.getScriptProperties().getProperty('SLACK_CHANNEL') || '#집밥';
  if (!token || token.indexOf('xoxb-') !== 0) return;
  try {
    UrlFetchApp.fetch('https://slack.com/api/chat.postMessage', {
      method: 'post',
      contentType: 'application/json; charset=utf-8',
      headers: { 'Authorization': 'Bearer ' + token },
      payload: JSON.stringify({ channel: channel, thread_ts: threadTs, text: text }),
      muteHttpExceptions: true
    });
  } catch (e) { log_('스레드 실패: ' + e.message); }
}

function logPicks_(picks, ts) {
  const sheet = ensureLogSheet();
  const today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
  picks.forEach((p, i) => {
    sheet.appendRow([today, i + 1, p.name, p.cook_time_min, p.servings, p.url, ts || new Date().toISOString()]);
  });
}

function ensureLogSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.LOG_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.LOG_SHEET_NAME);
    sheet.appendRow(['날짜', '순번', '요리명', '시간(분)', '인분', 'URL', 'Slack TS']);
    sheet.getRange(1, 1, 1, 7).setFontWeight('bold').setBackground('#2d2d2d').setFontColor('#ffffff');
    sheet.setFrozenRows(1);
    sheet.autoResizeColumns(1, 7);
  }
  return sheet;
}

function installDailyTrigger() {
  deleteAllTriggers();
  ScriptApp.newTrigger('sendDailyPicks')
    .timeBased().atHour(18).everyDays(1).inTimezone('Asia/Seoul').create();
  SpreadsheetApp.getUi().alert('✅ 트리거 설치 완료\n매일 18:00 자동 발송됩니다.');
}

function deleteAllTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => ScriptApp.deleteTrigger(t));
  if (triggers.length > 0) log_(`🗑 ${triggers.length}개 트리거 삭제`);
}

function testWebhook() {
  const ui = SpreadsheetApp.getUi();
  const testPayload = {
    text: '🧪 Webhook 테스트',
    blocks: [{
      type: 'section',
      text: { type: 'mrkdwn', text: '*✅ v3.0 봇 연결 테스트*\n이제 짧고 매력적인 추천형 메시지로 발송됩니다!' }
    }, {
      type: 'actions',
      elements: [{
        type: 'button',
        text: { type: 'plain_text', text: '🎲 지금 저녁 추천 받기', emoji: true },
        url: 'https://kwak8711.github.io/recipes/',
        style: 'primary'
      }]
    }]
  };
  const result = sendSlack_(testPayload);
  if (result.ok) ui.alert('✅ 테스트 성공!', 'Slack 채널 확인하세요.', ui.ButtonSet.OK);
  else ui.alert('❌ 실패', result.error, ui.ButtonSet.OK);
}

function checkConfig() {
  const props = PropertiesService.getScriptProperties().getProperties();
  const triggers = ScriptApp.getProjectTriggers();
  const info = triggers.map(t => `  - ${t.getHandlerFunction()}: ${t.getEventType()}`).join('\n') || '  (없음)';
  const hasBot = props.SLACK_BOT_TOKEN && props.SLACK_BOT_TOKEN.indexOf('xoxb-') === 0;
  const msg = `📋 봇 설정 (v3.0)\n\n` +
    `🔑 스크립트 속성:\n` +
    `  - SLACK_WEBHOOK_URL: ${props.SLACK_WEBHOOK_URL ? '✅' : '❌ 미설정'}\n` +
    `  - SLACK_CHANNEL: ${props.SLACK_CHANNEL || '(기본 #집밥)'}\n` +
    `  - SLACK_BOT_TOKEN: ${hasBot ? '✅ 스레드 활성' : '⚠️ 미설정'}\n\n` +
    `⏰ 트리거 (${triggers.length}개):\n${info}\n\n` +
    `📡 레시피: ${CONFIG.RECIPES_URL}\n🏠 pantry: ${CONFIG.PANTRY_URL}\n🌐 피커: ${CONFIG.PICKER_URL}`;
  SpreadsheetApp.getUi().alert(msg);
}

function listAllRecipes() {
  const recipes = fetchRecipes();
  if (!recipes.length) { SpreadsheetApp.getUi().alert('로딩 실패'); return; }
  const byCat = {};
  recipes.forEach(r => { if (!byCat[r.category]) byCat[r.category] = []; byCat[r.category].push(r); });
  const list = Object.keys(byCat).map(cat =>
    `[${cat}] ${byCat[cat].length}개\n` + byCat[cat].map(r => `  - ${r.name} (${r.cook_time_min}분)`).join('\n')
  ).join('\n\n');
  SpreadsheetApp.getUi().alert(`📚 전체 ${recipes.length}개\n\n${list}`);
}

function promptAddRecipe() {
  const ui = SpreadsheetApp.getUi();
  const resp = ui.prompt('🔗 레시피 URL 추가', '만개의레시피 URL:', ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  const url = resp.getResponseText().trim();
  if (!/10000recipe\.com\/recipe\/\d+/.test(url)) { ui.alert('⚠️ 올바른 URL이 아닙니다'); return; }
  ui.alert('📝 등록 안내', `Claude에게 전달:\n\n${url}`, ui.ButtonSet.OK);
}

function log_(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }
