// 냥코위키 — 페이지 이동(#/주소)과 홈 화면
import { GD, BYID, store, bindImport, view, icon, esc } from "./common.js";
import { bindEdit } from "./edit.js";
import { renderDex } from "./dex.js";
import { renderCats } from "./cats.js";
import { renderCat } from "./cat.js";
import { renderPlan } from "./plan.js";
import { renderEnemies, renderEnemy, loadEnemies, enemyIcon } from "./enemy.js";
import { renderStages, renderMap, renderStage } from "./stage.js";
import { renderSchedule } from "./schedule.js";
import { renderNp } from "./np.js";

const main = document.getElementById("page");
let refresh = null;  // 지금 페이지를 다시 그리는 함수 (내 도감 데이터가 바뀌면 호출)

// 메뉴에 있는 주소. 준비 중인 메뉴는 링크 없이 보여준다.
const NAV = [
  { href: "#/cats", label: "캐릭터", match: /^#\/cats?\b/ },
  { href: "#/dex", label: "내 도감", match: /^#\/dex/ },
  { href: "#/plan", label: "육성", match: /^#\/plan/ },
  { href: "#/enemies", label: "적", match: /^#\/enem/ },
  { href: "#/stages", label: "스테이지", match: /^#\/stage/ },
  { href: "#/schedule", label: "일정", match: /^#\/schedule/ },
  { href: "#/np", label: "NP효율", match: /^#\/np/ },
];

// 홈 메뉴: [주소, 이름, 짧은 설명, 그림]
const HOME_MENU = [
  ["#/cats", "캐릭터", "스탯·본능·진화 재료", "icons/25_2.png"],
  ["#/dex", "내 도감", "보유 캐릭 관리", "icons/0_2.png"],
  ["#/plan", "육성", "재료·경험치 계산", "icons/items/22.png"],
  ["#/enemies", "적", "배율·능력·상대 캐릭", "icons/enemy/4.png"],
  ["#/stages", "스테이지", "출현 적·드롭", "icons/enemy/2.png"],
  ["#/schedule", "일정", "스테이지·뽑기 일정", "icons/items/20.png"],
  ["#/np", "NP효율", "뽑기·강습·지도 NP 비교", "icons/items/7.png"],
];

function renderHome(root) {
  const art = [44, 136, 43].map(id => BYID.get(id)).filter(Boolean)
    .map(c => { const f = c.forms.length - 1; return c.forms[f].icon ? `<img src="icons/${c.id}_${f}.png" alt="">` : ""; }).join("");
  root.innerHTML = `
    <section class="home-top">
      <div>
        <h1>냥코<em>위키</em></h1>
        <p>냥코대전쟁 한국판 캐릭터 ${GD.cats.length}종, 적, 스테이지를 게임 데이터로 정리했어요.</p>
        <div class="home-search">
          <input type="search" id="hsQ" placeholder="캐릭터·적 이름으로 찾기" aria-label="캐릭터·적 검색" autocomplete="off">
          <div class="hs-res" id="hsRes"></div>
        </div>
      </div>
      <div class="home-art" aria-hidden="true">${art}</div>
    </section>
    <nav class="home-menu" aria-label="바로가기">${HOME_MENU.map(([href, name, sub, img]) =>
      `<a href="${href}"><img src="${img}" alt="" loading="lazy"><b>${name}</b><span>${sub}</span></a>`).join("")}</nav>
    ${homeMine()}
    ${homeNotice()}
    <p class="home-ver">게임 데이터 v${GD.version}</p>`;
  bindHomeSearch(root);
  const nd = root.querySelector(".home-notice");
  nd.addEventListener("toggle", () => {
    try { localStorage.setItem(NOTICE_KEY, nd.open ? "1" : "0"); } catch {}
  });
}

// 인게임 공지: 게임 안 공지 창과 같은 PONOS 페이지를 그대로 띄운다 (CORS가 없어 내용만 가져올 수는 없음)
const NOTICE_KEY = "nyanko-wiki.homeNotice";
function noticeUrl() {
  const [a = 0, b = 0, c = 0] = String(GD.version).split(".").map(Number);
  const q = new URLSearchParams({
    platform: "google", clientVersion: String(a * 10000 + b * 100 + c), countryCode: "ko",
    clearedStageJapan: "100", clearedStageFuture: "100", clearedUniverse: "100", timeDifference: "9",
  });
  return `https://nyanko-announcement.ponosgames.com/v1/notices?${q}`;
}
function homeNotice() {
  let open = true;
  try { open = localStorage.getItem(NOTICE_KEY) !== "0"; } catch {}
  const url = esc(noticeUrl());
  return `<details class="panel home-notice"${open ? " open" : ""}>
      <summary><h2>인게임 공지<a class="ctl" href="${url}" target="_blank" rel="noopener noreferrer">새 창으로 ↗</a></h2></summary>
      <iframe src="${url}" title="냥코대전쟁 인게임 공지" loading="lazy" referrerpolicy="no-referrer"
        sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"></iframe>
      <p class="note">게임 안 공지 창과 같은 PONOS 페이지를 그대로 보여줘요.</p></details>`;
}

// 내 도감 요약 (세이브를 안 불러왔으면 안내)
function homeMine() {
  const cats = store.data?.cats;
  if (!cats || !Object.keys(cats).length) return `<section class="home-mine">
      <h2>내 도감</h2><p>블루스택 세이브를 불러오면 보유 캐릭·레벨·본능과 재료가 한 번에 채워져요.</p>
      <div class="acts"><a class="btn primary" href="#/dex">내 도감 열기</a></div></section>`;
  const vs = GD.cats.map(view).filter(v => v.o);
  const ready = vs.filter(v => v.tfReady || v.ffReady).length;
  const maxed = vs.filter(v => v.lvTotal >= v.maxLv).length;
  return `<section class="home-mine">
      <h2>내 도감</h2>
      <div class="nums"><span><b>${vs.length}</b>보유 / ${GD.cats.length}</span><span><b>${ready}</b>지금 진화 가능</span><span><b>${maxed}</b>만렙</span></div>
      <div class="acts"><a class="btn primary" href="#/dex">내 도감</a><a class="btn" href="#/plan">육성 계획</a></div></section>`;
}

// 홈 검색: 캐릭터는 바로, 적은 처음 입력할 때 목록을 받아서 같이 찾는다
function bindHomeSearch(root) {
  const inp = root.querySelector("#hsQ"), res = root.querySelector("#hsRes");
  let enemies = null, hits = [];
  const draw = () => {
    const q = inp.value.trim().toLowerCase();
    if (!q) { res.innerHTML = ""; hits = []; return; }
    const cats = GD.cats.flatMap(c => {
      const fi = c.forms.findIndex(f => f.name.toLowerCase().includes(q));
      return fi < 0 && String(c.id) !== q ? [] : [{ href: `#/cat/${c.id}`, name: c.forms[Math.max(fi, 0)].name, img: icon(c, Math.max(fi, 0)), tag: `캐릭터 #${c.id}` }];
    });
    const ens = (enemies || []).filter(e => !e.hidden && e.name.toLowerCase().includes(q))
      .map(e => ({ href: `#/enemy/${e.id}`, name: e.name, img: enemyIcon(e, "sm"), tag: `적 #${e.id}` }));
    hits = [...cats.slice(0, 8), ...ens.slice(0, 6)];
    res.innerHTML = hits.length ? hits.map(h => `<a href="${h.href}">${h.img}<span>${esc(h.name)}</span><small>${h.tag}</small></a>`).join("")
      : `<p>"${esc(inp.value.trim())}"에 맞는 캐릭터·적이 없어요.</p>`;
  };
  inp.addEventListener("input", () => {
    if (!enemies) loadEnemies().then(d => { enemies = d.list; draw(); }).catch(() => {});
    draw();
  });
  inp.addEventListener("keydown", e => { if (e.key === "Enter" && hits[0]) location.hash = hits[0].href; if (e.key === "Escape") { inp.value = ""; draw(); } });
}

function route() {
  const h = location.hash || "#/";
  const cat = h.match(/^#\/cat\/(\d+)/);
  const enemy = h.match(/^#\/enemy\/(\d+)/);
  const stage = h.match(/^#\/stage\/(\d+)(?:\/(\d+))?/);
  if (cat) refresh = renderCat(main, +cat[1]);
  else if (enemy) refresh = renderEnemy(main, +enemy[1]);
  else if (stage) refresh = stage[2] != null ? renderStage(main, +stage[1], +stage[2]) : renderMap(main, +stage[1]);
  else if (h.startsWith("#/stages")) refresh = renderStages(main);
  else if (h.startsWith("#/enemies")) refresh = renderEnemies(main);
  else if (h.startsWith("#/cats")) refresh = renderCats(main);
  else if (h.startsWith("#/dex")) refresh = renderDex(main);
  else if (h.startsWith("#/plan")) refresh = renderPlan(main);
  else if (h.startsWith("#/schedule")) refresh = renderSchedule(main);
  else if (h.startsWith("#/np")) refresh = renderNp(main);
  else { renderHome(main); refresh = null; }
  document.querySelectorAll(".nav a").forEach(a =>
    a.toggleAttribute("aria-current", NAV.find(n => n.href === a.getAttribute("href"))?.match.test(h)));
  document.querySelectorAll(".nav a[aria-current]").forEach(a => a.setAttribute("aria-current", "page"));
  const t = main.querySelector("h1")?.textContent;
  document.title = t && t !== "냥코위키" ? `${t} - 냥코위키` : "냥코위키";
  window.scrollTo(0, 0);
}

document.getElementById("nav").innerHTML = NAV.map(n =>
  n.href ? `<a href="${n.href}">${n.label}</a>` : `<span title="준비 중">${n.label}<small>준비 중</small></span>`).join("");
// 밝게·어둡게: 처음엔 기기 설정을 따르고, 누르면 반대로 바꿔서 기억한다
const themeBtn = document.getElementById("themeBtn");
const isDark = () => (document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")) === "dark";
const paintThemeBtn = () => {
  const dark = isDark();
  themeBtn.textContent = dark ? "☀" : "☾";
  themeBtn.title = themeBtn.ariaLabel = dark ? "밝게 보기" : "어둡게 보기";
};
themeBtn.onclick = () => {
  const t = isDark() ? "light" : "dark";
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem("nyanko-wiki.theme", t); } catch {}
  paintThemeBtn();
};
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", paintThemeBtn);
paintThemeBtn();
store.listeners.add(() => refresh?.());
bindImport();
bindEdit();
addEventListener("hashchange", route);
route();
