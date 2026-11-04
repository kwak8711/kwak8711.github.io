/**
 * 🍚 공주님 오늘 저녁 자동 추천 봇 v3.1
 *
 * v3.1 신규:
 *   - 등록된 53개 레시피에서만 추천 (외부 검색 X)
 *   - 🛒 "사야할 재료" 자동 노출
 *   - 🏠 "집에 있는 재료" 명확히 표시
 *   - 요리 완성 후 재료 차감은 웹에서 (Slack에서는 안내만)
 */

const CONFIG = {
  RECIPES_URL: 'https://raw.githubusercontent.com/kwak8711/kwak8711.github.io/main/recipes/data/recipes.json',
  PANTRY_URL: 'https://raw.githubusercontent.com/kwak8711/kwak8711.github.io/main/recipes/data/pantry.json',
  PICKER_URL: 'https://kwak8711.github.io/recipes/',
  LOG_SHEET_NAME: '선택로그',
  PANTRY_SHEET_NAME: '재료현황',
  SHOPPING_SHEET_NAME: '장보기목록',
  WEEKDAY_RECIPE_MAX_MIN: 30,
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🍚 레시피')
    .addItem('1. 트리거 설치 (매일 18:00)', 'installDailyTrigger')
    .addItem('2. 지금 추천 보내기', 'sendDailyPicks')
    .addItem('3. 레시피 목록 보기', 'listAllRecipes')
    .addSeparator()
    .addItem('4. 🏠 재료 현황 새로고침', 'refreshPantrySheet')
    .addItem('5. 🛒 장보기 리스트 보기', 'showShoppingList')
    .addItem('6. 📝 요리 완성 → 재료 차감', 'promptConsumeRecipe')
    .addSeparator()
    .addItem('7. 선택 로그 시트 생성', 'ensureLogSheet')
    .addItem('8. URL로 레시피 추가', 'promptAddRecipe')
    .addItem('9. 모든 트리거 삭제', 'deleteAllTriggers')
    .addItem('10. 설정 확인', 'checkConfig')
    .addItem('11. Webhook 재테스트', 'testWebhook')
    .addToUi();
}

function sendDailyPicks() {
  const recipes = fetchRecipes();
  const pantry = fetchPantry();
  if (!recipes || recipes.length === 0) { log_('⚠️ 레시피 로딩 실패'); return; }

  const picks = pickWithPantry_(recipes, pantry, 3);
  const result = sendMainMessage_(picks, pantry, recipes.length);

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

// pantry 매칭: 있는 것 / 없는 것 둘 다 반환
function matchPantry_(recipe, pantry) {
  const result = { have: [], missing: [], haveCount: 0, totalCount: 0 };
  if (!pantry.ingredients || pantry.ingredients.length === 0) return result;
  const pantryNames = pantry.ingredients.map(i => i.name);
  const aliases = pantry.match_aliases || {};

  // 레시피의 main_ingredients만 체크 (main이 진짜 필요한 재료)
  const checkList = recipe.main_ingredients || [];
  result.totalCount = checkList.length;

  for (const ingredient of checkList) {
    let found = false;
    for (const pName of pantryNames) {
      const alts = aliases[pName] || [pName];
      if (alts.some(a => ingredient.indexOf(a) > -1 || a.indexOf(ingredient) > -1)) {
        result.have.push(ingredient);
        result.haveCount++;
        found = true;
        break;
      }
    }
    if (!found) {
      // 흔한 양념은 "있다고 가정" (소금, 후추, 간장, 설탕 등)
      const commonSeasoning = ['소금', '후추', '간장', '설탕', '물', '식용유', '다진마늘', '참기름'];
      if (!commonSeasoning.some(s => ingredient.indexOf(s) > -1)) {
        result.missing.push(ingredient);
      } else {
        result.haveCount++; // common → have로 간주
      }
    }
  }
  return result;
}

// pantry 우선 + 요일/날씨 가중치
function pickWithPantry_(recipes, pantry, count) {
  const now = new Date();
  const isWeekday = now.getDay() >= 1 && now.getDay() <= 5;
  const month = now.getMonth() + 1;
  const isCold = month <= 3 || month >= 10;

  const scored = recipes.map(r => {
    const m = matchPantry_(r, pantry);
    // 매칭 % 가 높을수록 가중치 급상승
    const matchRatio = m.totalCount > 0 ? m.haveCount / m.totalCount : 0;
    let weight = 1 + (matchRatio * 5); // 100% 매칭 → 6배
    const tags = r.tags || [];
    if (isWeekday && r.cook_time_min <= 30) weight *= 1.3;
    if (isCold && (tags.indexOf('찌개') > -1 || tags.indexOf('국') > -1)) weight *= 1.5;
    return { recipe: r, weight: weight, match: m };
  });

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

// v3.1 메시지: 있는 재료 + 사야할 재료
function sendMainMessage_(picks, pantry, totalRecipes) {
  const today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'M월 d일 (E)');
  const main = picks[0];
  const others = picks.slice(1);
  const match = main._match || { have: [], missing: [] };

  const kcal = main.kcal_per_serving || '?';
  const kcalEmoji = kcal === '?' ? '🔥' : (kcal < 300 ? '🟢' : kcal < 500 ? '🟡' : kcal < 700 ? '🟠' : '🔴');
  const cost = (main.cost_per_serving_krw || main.cost_krw || 0).toLocaleString();

  // 추천 헤드라인 (매칭 재료 기반)
  const topHave = match.have.slice(0, 3);
  const hint = topHave.length > 0
    ? `냉장고에 *${topHave.join(', ')}* 있으니까`
    : `${totalRecipes}개 등록 메뉴 중`;

  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `👑 *${today}, 오늘 저녁*\n${hint}\n\n🍽️ *${main.name}* 어떠세요?`
      }
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `⏱ ${main.cook_time_min}분 · ${kcalEmoji} ${kcal}kcal · 💰 ₩${cost}/인`
      }
    }
  ];

  // 재료 체크 (있음/없음)
  if (match.totalCount > 0) {
    const haveText = match.have.length > 0 ? `🏠 *집에 있음* (${match.haveCount}/${match.totalCount}): ${match.have.join(', ')}` : '';
    const missingText = match.missing.length > 0 ? `\n🛒 *사야함*: ${match.missing.join(', ')}` : '\n✅ *모든 재료 준비 완료!*';
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: haveText + missingText }
    });
  }

  // 액션 버튼
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
        text: { type: 'plain_text', text: '🌐 다른 메뉴', emoji: true },
        url: CONFIG.PICKER_URL + '?filter=pantry'
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: '🛒 장보기 추가', emoji: true },
        url: CONFIG.PICKER_URL + '#shopping'
      }
    ]
  });

  // 다른 추천 (매칭률 포함)
  if (others.length > 0) {
    const othersText = others.map((r, i) => {
      const m = r._match || { haveCount: 0, totalCount: 0 };
      const ratio = m.totalCount > 0 ? Math.round(m.haveCount / m.totalCount * 100) : 0;
      const k = r.kcal_per_serving || '?';
      return `${i+2}. *${r.name}* _(${r.cook_time_min}분·${k}kcal · 재료 ${ratio}%)_`;
    }).join('\n');
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*🎲 다른 추천:*\n${othersText}` }
    });
  }

  blocks.push({
    type: 'context',
    elements: [{
      type: 'mrkdwn',
      text: `🌐 <${CONFIG.PICKER_URL}|웹에서 ${totalRecipes}개 전체 보기> · 🏠 pantry 기반 추천`
    }]
  });

  return sendSlack_({
    text: `🍽️ 오늘 저녁: ${main.name}`,
    blocks: blocks
  });
}

function buildThreadMessage_(main) {
  const match = main._match || { missing: [] };
  let msg = '🍳 요리 완성하면 👉 ' + CONFIG.PICKER_URL + ' 에서 *재료 차감* 버튼 눌러주세요!';
  if (match.missing && match.missing.length > 0) {
    msg += `\n\n🛒 *장보기 리스트에 추가하기:*\n${match.missing.map(m => `• ${m}`).join('\n')}`;
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

// ============================================================
// 재료 현황 시트 (pantry.json 미러링)
// ============================================================
function refreshPantrySheet() {
  const pantry = fetchPantry();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.PANTRY_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.PANTRY_SHEET_NAME);
  } else {
    sheet.clear();
  }
  sheet.appendRow(['재료명', '수량', '단위', '카테고리', '추가일', '상태']);
  sheet.getRange(1, 1, 1, 6).setFontWeight('bold').setBackground('#2d2d2d').setFontColor('#ffffff');
  sheet.setFrozenRows(1);
  pantry.ingredients.forEach(i => {
    const status = i.qty <= 1 ? '⚠️ 부족' : i.qty >= 5 ? '🟢 넉넉' : '🟡 보통';
    sheet.appendRow([i.name, i.qty, i.unit, i.category, i.added, status]);
  });
  sheet.autoResizeColumns(1, 6);
  SpreadsheetApp.getUi().alert(`✅ 재료 현황 업데이트 완료 (${pantry.ingredients.length}개)`);
}

// ============================================================
// 장보기 리스트 (최근 발송한 추천의 missing 재료 모음)
// ============================================================
function showShoppingList() {
  const recipes = fetchRecipes();
  const pantry = fetchPantry();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.SHOPPING_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(CONFIG.SHOPPING_SHEET_NAME);
  sheet.clear();

  sheet.appendRow(['재료', '필요 레시피', '구매 여부']);
  sheet.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground('#2d2d2d').setFontColor('#ffffff');
  sheet.setFrozenRows(1);

  // pantry 매칭 60% 이상 레시피들의 missing 재료 집계
  const shoppingMap = {};
  recipes.forEach(r => {
    const m = matchPantry_(r, pantry);
    const ratio = m.totalCount > 0 ? m.haveCount / m.totalCount : 0;
    if (ratio >= 0.5) {
      m.missing.forEach(ing => {
        if (!shoppingMap[ing]) shoppingMap[ing] = [];
        shoppingMap[ing].push(r.name);
      });
    }
  });

  // 많이 쓰이는 재료 순으로 정렬
  const sorted = Object.keys(shoppingMap).sort((a, b) => shoppingMap[b].length - shoppingMap[a].length);
  sorted.forEach(ing => {
    sheet.appendRow([ing, shoppingMap[ing].join(', '), '☐']);
  });
  sheet.autoResizeColumns(1, 3);
  SpreadsheetApp.getUi().alert(
    `🛒 장보기 리스트 생성 완료 (${sorted.length}개)\n\n` +
    `매칭 50% 이상 레시피에서 자주 빠진 재료를 모았어요.\n` +
    `시트에서 확인하세요!`
  );
}

// ============================================================
// 요리 완성 → 재료 차감
// ============================================================
function promptConsumeRecipe() {
  const ui = SpreadsheetApp.getUi();
  const resp = ui.prompt(
    '📝 요리 완성!',
    '먹은 요리 이름을 입력하세요 (일부만 입력 OK):\n예: 로제, 김치규동, 두부스테이크',
    ui.ButtonSet.OK_CANCEL
  );
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  const query = resp.getResponseText().trim();
  if (!query) return;

  const recipes = fetchRecipes();
  const pantry = fetchPantry();
  const matches = recipes.filter(r => r.name.indexOf(query) > -1);

  if (matches.length === 0) {
    ui.alert('⚠️ 매칭 레시피 없음', `"${query}"에 해당하는 레시피를 찾지 못했어요.`, ui.ButtonSet.OK);
    return;
  }

  const recipe = matches[0];
  const m = matchPantry_(recipe, pantry);

  // 재료현황 시트에서 수량 차감
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.PANTRY_SHEET_NAME);
  if (!sheet) { refreshPantrySheet(); sheet = ss.getSheetByName(CONFIG.PANTRY_SHEET_NAME); }

  const data = sheet.getDataRange().getValues();
  const consumed = [];
  const aliases = pantry.match_aliases || {};

  m.have.forEach(ingredient => {
    // ingredient가 어떤 pantry 재료와 매칭되는지 찾기
    for (let i = 1; i < data.length; i++) {
      const pName = data[i][0];
      const alts = aliases[pName] || [pName];
      if (alts.some(a => ingredient.indexOf(a) > -1 || a.indexOf(ingredient) > -1)) {
        const oldQty = Number(data[i][1]) || 0;
        const newQty = Math.max(0, oldQty - 1);
        sheet.getRange(i + 1, 2).setValue(newQty);
        const newStatus = newQty <= 0 ? '🔴 소진' : newQty <= 1 ? '⚠️ 부족' : newQty >= 5 ? '🟢 넉넉' : '🟡 보통';
        sheet.getRange(i + 1, 6).setValue(newStatus);
        consumed.push(`${pName}: ${oldQty} → ${newQty}`);
        break;
      }
    }
  });

  ui.alert(
    `✅ 요리 완성: ${recipe.name}`,
    `🔥 차감된 재료:\n${consumed.join('\n') || '(차감된 재료 없음)'}\n\n` +
    `💡 재료 현황 시트에서 확인하세요!\n` +
    `(수량 0 되면 자동 "소진" 표시)`,
    ui.ButtonSet.OK
  );

  // 선택로그에도 기록
  const logSheet = ensureLogSheet();
  const today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
  logSheet.appendRow([today, '요리완성', recipe.name, recipe.cook_time_min, recipe.servings, recipe.url, '수동입력']);
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
      text: { type: 'mrkdwn', text: '*✅ v3.1 봇 연결 테스트*\n이제 등록된 레시피만 추천하고, 재료 체크도 해드려요!' }
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
  const info = triggers.map(t => `  - ${t.getHandlerFunction()}`).join('\n') || '  (없음)';
  const hasBot = props.SLACK_BOT_TOKEN && props.SLACK_BOT_TOKEN.indexOf('xoxb-') === 0;
  const msg = `📋 봇 설정 (v3.1)\n\n` +
    `🔑 스크립트 속성:\n` +
    `  - SLACK_WEBHOOK_URL: ${props.SLACK_WEBHOOK_URL ? '✅' : '❌'}\n` +
    `  - SLACK_CHANNEL: ${props.SLACK_CHANNEL || '(기본 #집밥)'}\n` +
    `  - SLACK_BOT_TOKEN: ${hasBot ? '✅' : '⚠️'}\n\n` +
    `⏰ 트리거 (${triggers.length}개):\n${info}\n\n` +
    `📡 데이터:\n` +
    `  - 레시피: ${CONFIG.RECIPES_URL}\n` +
    `  - pantry: ${CONFIG.PANTRY_URL}\n` +
    `  - 피커: ${CONFIG.PICKER_URL}\n\n` +
    `🆕 v3.1 기능:\n` +
    `  - 등록된 레시피에서만 추천\n` +
    `  - 🛒 사야할 재료 자동 안내\n` +
    `  - 📝 요리 완성 시 재료 차감 (메뉴 6번)`;
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
