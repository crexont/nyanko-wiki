// 캐릭터 — 전체 캐릭 목록
import { GD, esc, icon, rarBadge, store, chips, toggle } from "./common.js";

const ui = { q: "", rar: new Set(), trait: new Set(), get: new Set(), sort: "id" };

// 얻는 방법 (gamedata cats[].get + 스테이지 드롭 목록 cat_drops.json). 캐릭 하나가 여러 개에 해당할 수 있다
const GET = [["basic", "기본 캐릭"], ["rare", "레어 뽑기"], ["normal", "냥코 뽑기"], ["gacha", "기타 뽑기"], ["drop", "스테이지 드롭"], ["etc", "기타(이벤트·미션 등)"]];
let drops = null;
fetch("data/stages/cat_drops.json").then(r => r.json()).then(d => { drops = new Set(Object.keys(d).map(Number)); })
  .catch(() => { drops = new Set(); }).finally(() => renderList());
function getKinds(c) {
  const g = c.get || {}, out = [];
  if (g.unlock) out.push("basic");
  if (g.src === 1) out.push("normal");
  if (g.src === 2) out.push(g.rare ? "rare" : "gacha");
  if (drops?.has(c.id)) out.push("drop");
  if (!out.length) out.push("etc");
  return out;
}

export function renderCats(root) {
  root.innerHTML = `
    <p class="crumb"><a href="#/">냥코위키</a><i>/</i><span>캐릭터</span></p>
    <div class="page-head">
      <div><h1>캐릭터</h1><p>한국판 냥코대전쟁 아군 캐릭터 ${GD.cats.length}종. 누르면 스탯·능력·본능·진화 재료를 볼 수 있어요.</p></div>
    </div>
    <div class="filters">
      <div class="row">
        <input type="search" id="cQ" placeholder="이름 또는 번호 검색" value="${esc(ui.q)}">
        <select id="cSort" aria-label="정렬"><option value="id">번호순</option><option value="rarity">레어도순</option><option value="name">이름순</option></select>
      </div>
      <div class="row" id="cRar"><span class="lbl">레어도</span></div>
      <div class="row" id="cTrait"><span class="lbl">속성</span></div>
      <div class="row" id="cGet"><span class="lbl">얻는 방법</span></div>
    </div>
    <p class="count" id="cCount"></p>
    <div class="mgrid" id="cGrid"></div>`;
  root.querySelector("#cSort").value = ui.sort;
  root.querySelector("#cQ").oninput = e => { ui.q = e.target.value.trim(); renderList(); };
  root.querySelector("#cSort").onchange = e => { ui.sort = e.target.value; renderList(); };
  const refresh = () => { buildFilters(); renderList(); };
  refresh();
  return refresh;
}

function buildFilters() {
  const re = () => { buildFilters(); renderList(); };
  chips(document.getElementById("cRar"), GD.rarities.map((r, i) => [i, r]), v => ui.rar.has(v), v => { toggle(ui.rar, v); re(); });
  chips(document.getElementById("cTrait"), GD.traits.map(t => [t, t]), v => ui.trait.has(v), v => { toggle(ui.trait, v); re(); });
  chips(document.getElementById("cGet"), GET, v => ui.get.has(v), v => { toggle(ui.get, v); re(); });
}

function renderList() {
  const grid = document.getElementById("cGrid"); if (!grid) return;
  const q = ui.q.toLowerCase();
  const list = GD.cats.filter(c => {
    if (ui.rar.size && !ui.rar.has(c.rarity)) return false;
    // 속성: 어느 진화 단계든 해당 속성을 타겟으로 하면 포함
    for (const t of ui.trait) if (!c.forms.some(f => f.traits.includes(t))) return false;
    // 얻는 방법: 고른 것 중 하나라도 해당하면 포함
    if (ui.get.size && !getKinds(c).some(k => ui.get.has(k))) return false;
    if (q && !c.forms.some(f => f.name.toLowerCase().includes(q)) && String(c.id) !== q) return false;
    return true;
  });
  const last = c => c.forms[c.forms.length - 1].name;
  if (ui.sort === "rarity") list.sort((a, b) => b.rarity - a.rarity || a.id - b.id);
  if (ui.sort === "name") list.sort((a, b) => last(a).localeCompare(last(b), "ko"));
  document.getElementById("cCount").textContent = `${list.length}종`;
  grid.innerHTML = list.length ? list.map(c => {
    const fi = c.forms.length - 1;
    return `<a class="mcard" href="#/cat/${c.id}" title="${esc(c.forms.map(f => f.name).join(" → "))}">
      ${store.owned(c.id) ? `<span class="owned-dot" title="보유"></span>` : ""}
      ${icon(c, fi)}<span class="name">${esc(c.forms[fi].name)}</span>
      <span class="sub">${rarBadge(c)}<span>#${c.id}</span></span></a>`;
  }).join("") : `<div class="empty">조건에 맞는 캐릭이 없습니다</div>`;
}
