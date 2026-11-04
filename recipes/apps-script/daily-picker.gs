/**
 * 🍚 공주님 집밥 허브 봇 v3.2 - 웹 각 탭 바로가기 포함
 *
 * v3.2 신규:
 *   - 메시지에 🌐 집밥 허브 바로가기 섹션 추가
 *   - [🎲 뽑기] [🏠 재료] [🛒 장보기] [📅 기록] 4버튼
 *   - 각 탭 현황 요약 (재료 N개 / 사야할 N개 / 최근 요리)
 *   - 짧고 핵심적인 메시지 유지
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
    .addItem('2. 지금 추천 보내기', 'sendDailyPicks')
    .addSeparator()
    .addItem('3. 모든 트리거 삭제', 'deleteAllTriggers')
    .addItem('4. 설정 확인', 'checkConfig')
    .addItem('5. Webhook 재테스트', 'testWebhook')
    .addToUi();
}

function sendDailyPicks() {
  const recipes = fetchRecipes();
  const pantry = fetchPantry();
  if (!recipes || recipes.length === 0) { log_('⚠️ 레시피 로딩 실패'); return; }

  const picks = pickWithPantry_(recipes, pantry, 3);
  const stats = calcStats_(recipes, pantry);
  const result = sendMainMessage_(picks, pantry, stats);

  if (result.ok) {
    logPicks_(picks, result.ts);
    if (result.ts) {
      sendThreadReply_(result.ts, buildThreadMessage_(picks[0]));
    }
    log_(`✅ 발송 - ${picks.map(p => p.name).join(', ')}`);
  } else {
    log_(`❌ 실패: ${result.error}`);
  }
}

function fetchRecipes() {
  try {
    const res = UrlFetchApp.fetch(CONFIG.RECIPES_URL, { muteHttpExceptions: true });
    return res.getResponseCode() === 200 ? (JSON.parse(res.getContentText()).recipes || []) : [];
  } catch (e) { return []; }
}

function fetchPantry() {
  try {
    const res = UrlFetchApp.fetch(CONFIG.PANTRY_URL, { muteHttpExceptions: true });
    return res.getResponseCode() === 200 ? JSON.parse(res.getContentText()) : { ingredients: [], match_aliases: {} };
  } catch (e) { return { ingredients: [], match_aliases: {} }; }
}

function matchPantry_(recipe, pantry) {
  const result = { have: [], missing: [], haveCount: 0, totalCount: 0 };
  if (!pantry.ingredients || !pantry.ingredients.length) return result;
  const names = pantry.ingredients.map(i => i.name);
  const aliases = pantry.match_aliases || {};
  const checkList = recipe.main_ingredients || [];
  result.totalCount = checkList.length;
  const seasonings = ['소금','후추','간장','설탕','물','식용유','다진마늘','참기름','고춧가루'];
  for (const ing of checkList) {
    let found = false;
    for (const p of names) {
      const alts = aliases[p] || [p];
      if (alts.some(a => ing.indexOf(a) > -1 || a.indexOf(ing) > -1)) {
        result.have.push(ing); result.haveCount++; found = true; break;
      }
    }
    if (!found) {
      if (seasonings.some(s => ing.indexOf(s) > -1)) result.haveCount++;
      else result.missing.push(ing);
    }
  }
  return result;
}

function pickWithPantry_(recipes, pantry, count) {
  const now = new Date();
  const isWeekday = now.getDay() >= 1 && now.getDay() <= 5;
  const month = now.getMonth() + 1;
  const isCold = month <= 3 || month >= 10;
  const scored = recipes.map(r => {
    const m = matchPantry_(r, pantry);
    const ratio = m.totalCount > 0 ? m.haveCount / m.totalCount : 0;
    let weight = 1 + (ratio * 5);
    const tags = r.tags || [];
    if (isWeekday && r.cook_time_min <= 30) weight *= 1.3;
    if (isCold && (tags.indexOf('찌개') > -1 || tags.indexOf('국') > -1)) weight *= 1.5;
    return { recipe: r, weight: weight, match: m };
  });
  const picks = []; const used = {};
  while (picks.length < count && picks.length < scored.length) {
    const total = scored.reduce((s, x) => used[x.recipe.id] ? s : s + x.weight, 0);
    let r = Math.random() * total;
    for (const w of scored) {
      if (used[w.recipe.id]) continue;
      r -= w.weight;
      if (r <= 0) { picks.push({ ...w.recipe, _match: w.match }); used[w.recipe.id] = true; break; }
    }
  }
  return picks;
}

// 허브 현황 집계
function calcStats_(recipes, pantry) {
  const totalIng = (pantry.ingredients || []).length;
  // 매칭 50% 이상 레시피들의 missing 재료 유니크 집계
  const missingSet = {};
  recipes.forEach(r => {
    const m = matchPantry_(r, pantry);
    const ratio = m.totalCount > 0 ? m.haveCount / m.totalCount : 0;
    if (ratio >= 0.5) m.missing.forEach(x => { missingSet[x] = true; });
  });
  const shopCount = Object.keys(missingSet).length;
  const pantryMatchable = recipes.filter(r => {
    const m = matchPantry_(r, pantry);
    return (m.totalCount > 0 ? m.haveCount / m.totalCount : 0) >= 0.5;
  }).length;
  return {
    totalRecipes: recipes.length,
    totalIng: totalIng,
    pantryMatchable: pantryMatchable,
    shopCount: shopCount
  };
}

// v3.2 메시지: 추천 + 현황 요약 + 각 탭 바로가기
function sendMainMessage_(picks, pantry, stats) {
  const today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'M월 d일 (E)');
  const main = picks[0];
  const others = picks.slice(1);
  const match = main._match || { have: [], missing: [] };

  const kcal = main.kcal_per_serving || '?';
  const kcalEmoji = kcal === '?' ? '🔥' : (kcal < 300 ? '🟢' : kcal < 500 ? '🟡' : kcal < 700 ? '🟠' : '🔴');
  const cost = (main.cost_per_serving_krw || main.cost_krw || 0).toLocaleString();

  const topHave = match.have.slice(0, 3);
  const hint = topHave.length > 0
    ? `냉장고에 *${topHave.join(', ')}* 있으니까`
    : `${stats.totalRecipes}개 등록 메뉴 중`;

  const blocks = [
    // 1. 추천 헤더
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `👑 *${today}, 오늘 저녁*\n${hint}\n\n🍽️ *${main.name}* 어떠세요?`
      }
    },
    // 2. 메인 메타 한 줄
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `⏱ ${main.cook_time_min}분 · ${kcalEmoji} ${kcal}kcal · 💰 ₩${cost}/인` }
    }
  ];

  // 3. 재료 체크
  if (match.totalCount > 0) {
    const haveTxt = match.have.length > 0 ? `🏠 *있음* (${match.haveCount}/${match.totalCount}): ${match.have.join(', ')}` : '';
    const missTxt = match.missing.length > 0 ? `\n🛒 *사야함*: ${match.missing.join(', ')}` : '\n✅ *모든 재료 준비 완료!*';
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: haveTxt + missTxt } });
  }

  // 4. 추천 액션 2버튼
  blocks.push({
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
        text: { type: 'plain_text', text: '✅ 다 먹었어 (재료 차감)', emoji: true },
        url: CONFIG.PICKER_URL + '?tab=pick'
      }
    ]
  });

  // 5. 다른 추천 간단히
  if (others.length > 0) {
    const txt = others.map((r, i) => {
      const m = r._match || { haveCount: 0, totalCount: 0 };
      const ratio = m.totalCount > 0 ? Math.round(m.haveCount / m.totalCount * 100) : 0;
      return `${i+2}. *${r.name}* _(${r.cook_time_min}분·${r.kcal_per_serving||'?'}kcal·재료 ${ratio}%)_`;
    }).join('\n');
    blocks.push({ type: 'divider' });
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*🎲 다른 추천:*\n${txt}` } });
  }

  // 6. ⭐ 집밥 허브 현황 요약
  blocks.push({ type: 'divider' });
  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*🌐 집밥 허브 현황*\n` +
            `📚 등록 레시피 *${stats.totalRecipes}개*\n` +
            `🏠 내 재료 *${stats.totalIng}개* · 🍽️ 지금 요리 가능 *${stats.pantryMatchable}개*\n` +
            `🛒 사야할 재료 *${stats.shopCount}개*`
    }
  });

  // 7. ⭐ 각 탭 바로가기 (핵심!)
  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: { type: 'plain_text', text: '🎲 뽑기', emoji: true },
        url: CONFIG.PICKER_URL + '?tab=pick'
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: '🏠 재료', emoji: true },
        url: CONFIG.PICKER_URL + '?tab=pantry'
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: '🛒 장보기', emoji: true },
        url: CONFIG.PICKER_URL + '?tab=shop'
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: '📅 기록', emoji: true },
        url: CONFIG.PICKER_URL + '?tab=log'
      }
    ]
  });

  // 8. 하단
  blocks.push({
    type: 'context',
    elements: [{
      type: 'mrkdwn',
      text: `✨ 매일 18:00 자동 발송 · 🏠 pantry 기반 추천 · 💾 수정은 웹에서`
    }]
  });

  return sendSlack_({
    text: `🍽️ 오늘 저녁: ${main.name}`,
    blocks: blocks
  });
}

function buildThreadMessage_(main) {
  const match = main._match || { missing: [] };
  let msg = '🍳 요리 완성하면 👉 웹 🎲 뽑기 탭에서 *"✅ 다 먹었어"* 버튼 터치!\n재료 자동 차감됩니다.';
  if (match.missing && match.missing.length > 0) {
    msg += `\n\n🛒 *장보기 자동 추가 대상:*\n${match.missing.map(m => '• ' + m).join('\n')}`;
  }
  return msg;
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
    return res.getResponseCode() === 200 ? { ok: true, ts: null } : { ok: false, error: `HTTP ${res.getResponseCode()}` };
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
      text: { type: 'mrkdwn', text: '*✅ v3.2 봇 연결 테스트*\n이제 각 탭 바로가기 버튼 포함!' }
    }, {
      type: 'actions',
      elements: [
        { type: 'button', text: { type: 'plain_text', text: '🎲 뽑기', emoji: true }, url: CONFIG.PICKER_URL + '?tab=pick' },
        { type: 'button', text: { type: 'plain_text', text: '🏠 재료', emoji: true }, url: CONFIG.PICKER_URL + '?tab=pantry' },
        { type: 'button', text: { type: 'plain_text', text: '🛒 장보기', emoji: true }, url: CONFIG.PICKER_URL + '?tab=shop' },
        { type: 'button', text: { type: 'plain_text', text: '📅 기록', emoji: true }, url: CONFIG.PICKER_URL + '?tab=log' }
      ]
    }]
  };
  const result = sendSlack_(testPayload);
  if (result.ok) ui.alert('✅ 테스트 성공!', 'Slack 채널 확인하세요.', ui.ButtonSet.OK);
  else ui.alert('❌ 실패', result.error, ui.ButtonSet.OK);
}

function checkConfig() {
  const props = PropertiesService.getScriptProperties().getProperties();
  const triggers = ScriptApp.getProjectTriggers();
  const info = triggers.map(t => `  - ${t.getHandlerFunction()}`).join('\n') || '  (없음)';
  const hasBot = props.SLACK_BOT_TOKEN && props.SLACK_BOT_TOKEN.indexOf('xoxb-') === 0;
  const msg = `📋 봇 설정 (v3.2)\n\n` +
    `🔑 스크립트 속성:\n` +
    `  - SLACK_WEBHOOK_URL: ${props.SLACK_WEBHOOK_URL ? '✅' : '❌'}\n` +
    `  - SLACK_CHANNEL: ${props.SLACK_CHANNEL || '(기본 #집밥)'}\n` +
    `  - SLACK_BOT_TOKEN: ${hasBot ? '✅ (스레드 ON)' : '⚠️'}\n\n` +
    `⏰ 트리거 (${triggers.length}개):\n${info}\n\n` +
    `🆕 v3.2: Slack 메시지에 웹 각 탭 바로가기 포함\n` +
    `  - 🎲 뽑기 · 🏠 재료 · 🛒 장보기 · 📅 기록 4버튼`;
  SpreadsheetApp.getUi().alert(msg);
}

function log_(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }
