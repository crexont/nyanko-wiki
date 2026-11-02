// 냥코위키 — 페이지 이동(#/주소)과 홈 화면
import { GD, BYID, store, bindImport } from "./common.js";
import { bindEdit } from "./edit.js";
import { renderDex } from "./dex.js";
import { renderCats } from "./cats.js";
import { renderCat } from "./cat.js";
import { renderPlan } from "./plan.js";
import { renderEnemies, renderEnemy } from "./enemy.js";
import { renderStages, renderMap, renderStage } from "./stage.js";

const main = document.getElementById("page");
let refresh = null;  // 지금 페이지를 다시 그리는 함수 (내 도감 데이터가 바뀌면 호출)

// 메뉴에 있는 주소. 준비 중인 메뉴는 링크 없이 보여준다.
const NAV = [
  { href: "#/cats", label: "캐릭터", match: /^#\/cats?\b/ },
  { href: "#/dex", label: "내 도감", match: /^#\/dex/ },
  { href: "#/plan", label: "육성", match: /^#\/plan/ },
  { href: "#/enemies", label: "적", match: /^#\/enem/ },
  { href: "#/stages", label: "스테이지", match: /^#\/stage/ },
  { label: "일정" },
];

function renderHome(root) {
  const art = [25, 43, 59, 34, 44, 136].filter(id => BYID.get(id))
    .map(id => { const c = BYID.get(id); const f = c.forms.length - 1; return c.forms[f].icon ? `<img src="icons/${id}_${f}.png" alt="">` : ""; }).join("");
  root.innerHTML = `
    <p class="crumb"><span>The Battle Cats</span><i>/</i><span>Korean Database</span></p>
    <section class="hero">
      <div>
        <p class="eyebrow">냥코대전쟁 · 한국판 데이터베이스</p>
        <h1>냥코위키</h1>
        <p>캐릭터 ${GD.cats.length}종과 적·스테이지 데이터를 찾아보고,</p>
        <p>내 세이브를 불러와 보유 캐릭과 육성 현황을 관리할 수 있어요.</p>
        <div class="acts">
          <a class="btn primary big" href="#/cats">캐릭터 찾아보기 <span aria-hidden="true">↗</span></a>
          <a class="btn big" href="#/dex">내 도감 <span aria-hidden="true">↗</span></a>
          <a class="btn big" href="#/plan">육성 <span aria-hidden="true">↗</span></a>
          <a class="btn big" href="#/enemies">적 <span aria-hidden="true">↗</span></a>
          <a class="btn big" href="#/stages">스테이지 <span aria-hidden="true">↗</span></a>
        </div>
      </div>
      <div class="hero-art" aria-hidden="true">${art}</div>
    </section>
    <div class="tiles">
      <a class="tile" href="#/cats"><b>캐릭터</b><span>진화 단계별 체력·공격력·사거리, 특수 능력, 본능, 3진·4진 재료</span></a>
      <a class="tile" href="#/dex"><b>내 도감</b><span>세이브를 불러오거나 직접 입력해서 보유·레벨·본능 관리</span></a>
      <a class="tile" href="#/plan"><b>육성</b><span>보유 재화·개다래·수석 관리, 지금 바로 진화 가능한 캐릭, 진화 계획 재료 합계·부족분</span></a>
      <a class="tile" href="#/enemies"><b>적</b><span>적 캐릭터 배율별 체력·공격력·DPS, 사거리, 속성, 능력</span></a>
      <a class="tile" href="#/stages"><b>스테이지</b><span>스테이지별 출현 적·배율·드롭, 적과 내 캐릭 사거리 비교</span></a>
      <div class="tile soon"><b>일정</b><span>이번 주 뽑기·이벤트·세일 일정</span></div>
    </div>
    <div class="foot-row"><span>게임 데이터 v${GD.version}</span></div>`;
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
store.listeners.add(() => refresh?.());
bindImport();
bindEdit();
addEventListener("hashchange", route);
route();
