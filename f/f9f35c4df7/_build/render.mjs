// 오늘의 운세 카드 렌더러
//   node render.mjs day.json out.jpg
// day.json 스키마는 sample-day.json 참고.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const COLOR = { wood:'#63bb85', fire:'#c4443c', earth:'#cf9226', metal:'#8b8fd6', water:'#2f6fb5' };
// 오행 순환도의 고정 좌표 (목→화→토→금→수 시계방향)
const NODE = {
  wood:  { x:160,   y:50,    label:'나무', sub:'표현 · 성장', subY:14  },
  fire:  { x:250.4, y:115.6, label:'불',   sub:'열정 · 활력', subY:80  },
  earth: { x:215.8, y:221.9, label:'흙',   sub:'안정 · 중심', subY:264 },
  metal: { x:104.2, y:221.9, label:'쇠',   sub:'결단 · 정리', subY:264 },
  water: { x:69.6,  y:115.6, label:'물',   sub:'생각 · 감정', subY:72  },
};
const ARROW = [[215.8,68.1,36],[250.4,174.4,108],[160,240,180],[69.6,174.4,252],[104.2,68.1,324]];

const esc = s => String(s).replace(/&(?![a-z#]+;)/g, '&amp;');

function pillars(ilju) {
  return [ilju.stem, ilju.branch].map(p => `
      <div><div class="han" style="background:${COLOR[p.el]}">${esc(p.han)}</div>
      <div class="ko">${esc(p.name)}</div><div class="el">${esc(p.desc)}</div></div>`).join('');
}

function wheel(oheng) {
  const by = Object.fromEntries(oheng.map(o => [o.el, o]));
  const arrows = ARROW.map(([x,y,r]) =>
    `<path d="M0,-5.5 L8,0 L0,5.5 Z" transform="translate(${x},${y}) rotate(${r})"/>`).join('');
  const rings = oheng.filter(o => o.today).map(o =>
    `<circle cx="${NODE[o.el].x}" cy="${NODE[o.el].y}" r="28" fill="none" stroke="${COLOR[o.el]}" stroke-width="2.5" opacity=".45"/>`).join('');
  const nodes = Object.entries(NODE).map(([el, n]) => {
    // 원 크기로 기운의 세기를 표현 (base 13% → 21px, 38% → 31px)
    const r = Math.round(18 + (by[el]?.base ?? 13) * 0.34);
    return `<circle cx="${n.x}" cy="${n.y}" r="${r}" fill="${COLOR[el]}"/>
      <text x="${n.x}" y="${n.y + 6}" font-size="14" fill="#fff">${n.label}</text>
      <text x="${n.x}" y="${n.subY}" font-size="11.5" fill="#6d6277">${n.sub}</text>`;
  }).join('');
  return `<svg width="326" height="272" viewBox="0 0 320 272">
    <circle cx="160" cy="145" r="95" fill="none" stroke="#efeae3" stroke-width="2" stroke-dasharray="5 7"/>
    <g fill="#dbd4ca">${arrows}</g>${rings}
    <g font-family="Jua" text-anchor="middle">${nodes}</g>
    <text x="160" y="140" font-size="12" fill="#a49aad" text-anchor="middle" font-family="Gowun">기운이 흐르는</text>
    <text x="160" y="160" font-size="12" fill="#a49aad" text-anchor="middle" font-family="Gowun">방향 →</text>
  </svg>`;
}

function ohengRows(oheng) {
  return oheng.map(o => {
    const add = o.add ? `<div class="oadd" style="left:${o.base}%;width:${o.add}%;background:${COLOR[o.el]}"></div>` : '';
    const note = o.today ? `${esc(o.note)} <b style="color:${COLOR[o.el]}">＋오늘</b>` : esc(o.note);
    return `<div class="orow"><div class="odot" style="background:${COLOR[o.el]}"></div>
      <div class="olab">${esc(o.label)}</div>
      <div class="otr"><div class="ofl" style="width:${o.base}%;background:${COLOR[o.el]}"></div>${add}</div>
      <div class="ost">${note}</div></div>`;
  }).join('');
}

const categories = cats => cats.map(c =>
  `<div class="cat"><div class="e">${c.emoji}</div><div class="n">${esc(c.name)}</div>
   <div class="bar"><i style="width:${Math.round(c.score / 5 * 100)}%"></i></div>
   <div class="v">${c.score.toFixed(1)}</div></div>`).join('');

const bullets = items => items.map(t => `<p>· ${esc(t)}</p>`).join('');
const swatches = cols => cols.map(c => `<i style="background:${c}"></i>`).join('');

const d = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const out = process.argv[3] ?? resolve(HERE, '../cards/' + d.date + '.jpg');

const html = readFileSync(resolve(HERE, 'template.html'), 'utf8')
  .replace('{{DATE_KO}}', esc(d.dateKo))
  .replace('{{ILJU_KO}}', esc(d.ilju.ko))
  .replace('{{ILJU_HAN}}', esc(d.ilju.han))
  .replace('{{PILLARS}}', pillars(d.ilju))
  .replace('{{HEADLINE}}', d.headline)
  .replace('{{SUMMARY}}', esc(d.summary))
  .replace('{{WHEEL}}', wheel(d.oheng))
  .replace('{{OHENG_ROWS}}', ohengRows(d.oheng))
  .replace('{{OHENG_NOTE}}', d.ohengNote)
  .replace('{{CATEGORIES}}', categories(d.categories))
  .replace('{{GOOD}}', bullets(d.good))
  .replace('{{WARN}}', bullets(d.warn))
  .replace('{{BEST_TIME}}', esc(d.bestTime))
  .replace('{{COLORS}}', swatches(d.luckyColors))
  .replace('{{DIRECTIONS}}', esc(d.directions));

const tmp = resolve(HERE, '.card.html');
writeFileSync(tmp, html);

// playwright는 컨테이너에 전역 설치되어 있어 절대 경로로 불러온다.
const pw = process.env.PLAYWRIGHT_ENTRY ?? '/opt/node22/lib/node_modules/playwright/index.js';
const pwModule = await import(pw);
const chromium = pwModule.chromium ?? pwModule.default?.chromium;
if (!chromium) throw new Error('playwright를 찾지 못했습니다: ' + pw);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 720, height: 400 }, deviceScaleFactor: 2 });
await page.goto('file://' + tmp);
await page.waitForTimeout(700);           // 웹폰트 로딩 대기
await page.screenshot({ path: out, fullPage: true, type: 'jpeg', quality: 92 });
await browser.close();
console.log('wrote ' + out);
