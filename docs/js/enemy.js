// 적 — 적 목록과 적 상세 (docs/data/enemies.json, 처음 열 때 한 번 받는다)
import { GD, esc, clamp, traitChips, chips, toggle, store, FORM } from "./common.js";
import { abilityText, loadUnits } from "./cat.js";

let enemiesPromise;
export const loadEnemies = () => enemiesPromise ??= fetch("data/enemies.json").then(r => {
  if (!r.ok) throw new Error(r.status);
  return r.json();
}).then(list => ({ list, byId: new Map(list.map(e => [e.id, e])) }));

let appearPromise;
const loadAppear = () => appearPromise ??= Promise.all([
  fetch("data/stages/enemy_stages.json").then(r => r.json()),
  fetch("data/stages/index.json").then(r => r.json()),
]);

const sec = frames => { const s = (frames / 30).toFixed(2).replace(/\.?0+$/, ""); return `${s}초`; };
const num = n => Math.floor(n).toLocaleString();
const f32 = Math.fround;
// 냥코DB(battlecats-db.com) 적 번호 = 적 ID + 2
export const dbEnemyUrl = id => `https://battlecats-db.com/enemy/${String(id + 2).padStart(3, "0")}.html`;
// 아이콘이 게임 데이터에 없는 적(간판 아가씨 등)은 이름 첫 글자로 자리를 채운다
export const enemyIcon = (e, cls = "") => e?.icon
  ? `<img class="eicon ${cls}" src="icons/enemy/${e.id}.${e.icon === 1 ? "png" : e.icon}" alt="" loading="lazy">`
  : `<span class="eicon ph ${cls}" aria-hidden="true">${esc((e?.name || "?").replace(/^이름 없는 적 /, "")[0])}</span>`;

// 배율 적용 (BCU Entity / AtkModelEntity): 체력 = trunc(기본 × 배율), 공격력 = round(기본 × 배율). 배율은 float
export const enemyHp = (e, pct) => Math.trunc(f32(e.hp * f32(pct / 100)));
export const enemyAtk = (base, pct) => Math.round(f32(base * f32(pct / 100)));
// 공격 주기 (BCU DefaultData.getItv): 마지막 타 선딜 + max(공격간격×2 − 1, 모션 길이 − 마지막 타 선딜)
export function enemyCycle(e) {
  if (!e.anim) return null;
  const longPre = Math.max(...e.pre);
  return longPre + Math.max(e.tba * 2 - 1, e.anim - longPre);
}

const TRAITS = ["빨강", "떠있음", "검정", "메탈", "무속성", "천사", "에이리언", "좀비", "고대종", "악마", "사도", "초생명체", "초수", "초현자", "괴인", "마녀"];
// 능력 필터: [키, 이름, 해당 여부]. 비슷한 능력은 하나로 묶는다 (파동 = 파동·소파동 등)
const has = (...keys) => e => e.ab.some(a => keys.includes(a[0]));
const ABIL = [
  ["wave", "파동", has("wave", "miniWave")], ["surge", "열파", has("surge", "miniSurge", "deathSurge")],
  ["shield", "쉴드", has("demonShield")], ["barrier", "베리어", has("barrierHp")], ["warp", "워프", has("warp")],
  ["revive", "부활", has("revive")], ["burrow", "지하 이동", has("burrow")], ["toxic", "독", has("toxic")],
  ["curse", "저주", has("curse")], ["dodge", "공격 무효", has("dodge")], ["freeze", "멈춤", has("freeze")],
  ["slow", "느리게", has("slow")], ["kb", "날려버림", has("kb")], ["weaken", "공격력 다운", has("weaken")],
  ["crit", "크리티컬", has("crit")], ["survive", "살아남기", has("survive")], ["strengthen", "공격력 업", has("strengthen")],
  ["ld", "원거리", e => !!e.ld], ["area", "범위 공격", e => e.area],
];
const ui = { q: "", trait: new Set(), abil: new Set(), sort: "id", hidden: false };
// 정렬 기준: DPS·공격력은 기본(100%) 배율, 공격 합계 기준
const dpsOf = e => { const c = enemyCycle(e); return c ? e.atk.reduce((a, b) => a + b, 0) * 30 / c : 0; };

export function renderEnemies(root) {
  root.innerHTML = `
    <p class="crumb"><a href="#/">냥코위키</a><i>/</i><span>적</span></p>
    <div class="page-head">
      <div><h1>적</h1><p id="eLead">적 캐릭터 목록. 누르면 배율별 체력·공격력, 사거리, 능력을 볼 수 있어요.</p></div>
    </div>
    <div class="filters">
      <div class="row">
        <input type="search" id="eQ" placeholder="이름 또는 번호 검색" value="${esc(ui.q)}">
        <select id="eSort" aria-label="정렬"><option value="id">번호순</option><option value="hp">체력순</option><option value="atk">공격력순</option><option value="dps">DPS순</option><option value="range">사거리순</option><option value="speed">이동속도순</option><option value="name">이름순</option></select>
      </div>
      <div class="row" id="eTrait"><span class="lbl">속성</span></div>
      <div class="row" id="eAbil"><span class="lbl">능력</span></div>
      <div class="row"><label class="check"><input type="checkbox" id="eHidden"${ui.hidden ? " checked" : ""}> 이름 없는 적도 보기 <small>(도감에 안 나오는 콜라보·특수 적)</small></label></div>
    </div>
    <p class="count" id="eCount"></p>
    <div class="mgrid egrid" id="eGrid"><div class="empty">불러오는 중…</div></div>`;
  root.querySelector("#eSort").value = ui.sort;
  loadEnemies().then(({ list }) => {
    root.querySelector("#eLead").textContent = `한국판 냥코대전쟁 적 캐릭터 ${list.filter(e => !e.hidden).length}종. 누르면 배율별 체력·공격력, 사거리, 능력을 볼 수 있어요.`;
    const draw = () => drawList(list);
    const filters = () => {
      chips(root.querySelector("#eTrait"), TRAITS.map(t => [t, t]), v => ui.trait.has(v), v => { toggle(ui.trait, v); filters(); draw(); });
      chips(root.querySelector("#eAbil"), ABIL.map(([k, n]) => [k, n]), v => ui.abil.has(v), v => { toggle(ui.abil, v); filters(); draw(); });
    };
    root.querySelector("#eQ").oninput = e => { ui.q = e.target.value.trim(); draw(); };
    root.querySelector("#eSort").onchange = e => { ui.sort = e.target.value; draw(); };
    root.querySelector("#eHidden").onchange = e => { ui.hidden = e.target.checked; draw(); };
    filters(); draw();
  }).catch(() => { root.querySelector("#eGrid").innerHTML = `<div class="empty">적 데이터를 불러오지 못했어요. 새로고침해 주세요.</div>`; });
  return null;
}

function drawList(all) {
  const grid = document.getElementById("eGrid"); if (!grid) return;
  const q = ui.q.toLowerCase();
  const list = all.filter(e => {
    if (e.hidden && !ui.hidden) return false;
    for (const t of ui.trait) if (!e.traits.includes(t)) return false;
    for (const k of ui.abil) if (!ABIL.find(x => x[0] === k)[2](e)) return false;
    return !q || e.name.toLowerCase().includes(q) || String(e.id) === q;
  });
  if (ui.sort === "hp") list.sort((a, b) => b.hp - a.hp);
  if (ui.sort === "range") list.sort((a, b) => b.range - a.range);
  if (ui.sort === "atk") list.sort((a, b) => b.atk.reduce((x, y) => x + y, 0) - a.atk.reduce((x, y) => x + y, 0));
  if (ui.sort === "dps") list.sort((a, b) => dpsOf(b) - dpsOf(a));
  if (ui.sort === "speed") list.sort((a, b) => b.speed - a.speed);
  if (ui.sort === "name") list.sort((a, b) => a.name.localeCompare(b.name, "ko"));
  document.getElementById("eCount").textContent = `${list.length}종`;
  grid.innerHTML = list.length ? list.map(e => `<a class="mcard" href="#/enemy/${e.id}">
      ${enemyIcon(e)}<span class="name">${esc(e.name)}</span>
      <span class="sub"><span>#${e.id}</span>${e.traits.slice(0, 2).map(t => `<span class="tr mini" style="--c:var(--tr-${t})">${t}</span>`).join("")}</span></a>`).join("")
    : `<div class="empty">조건에 맞는 적이 없습니다</div>`;
}

const state = { id: null, hpPct: 100, atkPct: 100 };

export function renderEnemy(root, id) {
  if (state.id !== id) Object.assign(state, { id, hpPct: 100, atkPct: 100 });
  root.innerHTML = `<div class="empty">불러오는 중…</div>`;
  loadEnemies().then(({ byId }) => {
    const e = byId.get(id);
    if (!e) { root.innerHTML = `<div class="empty">적을 찾을 수 없어요. <a href="#/enemies">적 목록으로</a></div>`; return; }
    paint(root, e);
  }).catch(() => { root.innerHTML = `<div class="empty">적 데이터를 불러오지 못했어요. 새로고침해 주세요.</div>`; });
  return null;
}

function paint(root, e) {
  const hp = enemyHp(e, state.hpPct);
  const hits = e.atk.map(a => enemyAtk(a, state.atkPct));
  const total = hits.reduce((a, b) => a + b, 0);
  const cycleF = enemyCycle(e), tbaF = e.tba * 2;
  const longPre = Math.max(...e.pre), postF = e.anim ? e.anim - longPre : null;
  const dps = cycleF ? Math.floor(total * 30 / cycleF) : null;  // 적 DPS는 버림 (냥코DB·나무위키 적 문서와 같음)
  // 주는 돈: 보물·연구 최대 ×3.95, 게임처럼 정수 버림 (BCU EEnemy: money = (int)(money + 배수 × 기본))
  const money = v => Math.floor(v + 1e-9).toLocaleString();
  const F = f => f == null ? "-" : `${num(f)}<span> (${sec(f)})</span>`;
  const ldText = ([a, w]) => `${Math.min(a, a + w)}~${Math.max(a, a + w)}`;
  const multi = hits.length > 1;
  const lds = e.lds || (e.ld ? e.atk.map(() => e.ld) : null);
  const abil = e.ab.map(a => `<li>${esc(abilityText(a, []))}</li>`);
  if (e.area) abil.unshift("<li>범위 공격</li>");
  if (e.ld && !e.lds) abil.unshift(`<li>원거리 공격 (${ldText(e.ld)})</li>`);
  if (multi) abil.push(`<li>${hits.length}회 연속 공격</li>`);
  const pct = (k, label) => `<label>${label} <input type="number" id="${k}" min="1" max="100000" value="${state[k]}">%</label>`;

  root.innerHTML = `
    <p class="crumb"><a href="#/">냥코위키</a><i>/</i><a href="#/enemies">적</a><i>/</i><span>${esc(e.name)}</span></p>
    <section class="detail-head">
      ${enemyIcon(e, "big")}
      <div>
        <div class="badges"><span class="cid">#${e.id}</span>${e.dex ? "" : `<span class="tag">도감 미등록</span>`}</div>
        <h1>${esc(e.name)}</h1>
        ${traitChips(e.traits) || `<div class="sub">속성 없음</div>`}
        ${e.desc ? `<p class="desc">${esc(e.desc.replace(/【%s】/g, ""))}</p>` : ""}
      </div>
    </section>
    <div class="cols">
      <div>
        <div class="panel">
          <h2>스탯 <span class="ctl pct">${pct("hpPct", "체력")} ${pct("atkPct", "공격력")}</span></h2>
          <div class="nm">
            <div class="nm-box"><div class="nm-h">체력</div><div class="nm-rows"><div class="sel"><span>${state.hpPct}%</span> <b>${num(hp)}</b></div></div></div>
            <div class="nm-box"><div class="nm-h">공격력${multi ? ` (${hits.length}회 합계)` : ""}</div><div class="nm-rows"><div class="sel"><span>${state.atkPct}%</span> <b>${num(total)}</b></div>
              ${multi ? `<div class="sub-hit"><span>타격별</span> ${hits.map(num).join(" + ")}</div>` : ""}</div></div>
            <div class="nm-box${multi ? "" : " wide"}"><div class="nm-h">DPS</div><div class="nm-rows"><div class="sel"><span>${state.atkPct}%</span> <b>${dps == null ? "-" : num(dps)}</b></div></div></div>
            ${multi ? `<table class="nm-hits"><thead><tr><th>타격</th><th>선딜F</th>${lds ? "<th>유효 사거리</th>" : ""}</tr></thead><tbody>
              ${e.pre.map((p, i) => `<tr><td>${i + 1}타</td><td>${F(p)}</td>${lds ? `<td>${ldText(lds[i])}</td>` : ""}</tr>`).join("")}</tbody></table>` : ""}
          </div>
          <div class="nm-grid">
            <div><small>히트백</small><b>${e.kb}</b></div>
            <div><small>이동속도</small><b>${e.speed}</b></div>
            <div><small>사거리</small><b>${e.range}${!multi && e.ld ? `<span> (유효 ${ldText(e.ld)})</span>` : ""}</b></div>
            <div><small>주는 돈</small><b>${money(e.money * 3.95)}<span> (기본 ${num(e.money)})</span></b></div>
            <div><small>공격 범위</small><b>${e.area ? "범위" : "단일"}${e.ld ? "<span> · 원거리</span>" : ""}</b></div>
            <div><small>공격빈도F</small><b>${F(cycleF)}</b></div>
            <div><small>공격간격F</small><b>${F(tbaF)}</b></div>
            ${multi ? `<div><small>공격 횟수</small><b>${hits.length}회</b></div>` : `<div><small>선딜F</small><b>${F(e.pre[0])}</b></div>`}
            <div><small>후딜F</small><b>${F(postF)}</b></div>
            <div><small>넉백당 체력</small><b>${num(hp / Math.max(e.kb, 1))}</b></div>
          </div>
          <details class="calc-note"><summary>계산 기준</summary><p class="note">스테이지마다 적 배율(%)이 달라요. 체력 = 기본 체력 × 체력 배율, 공격력 = 기본 공격력 × 공격력 배율. F는 프레임(30F = 1초), 공격빈도 = 마지막 타 선딜 + max(공격간격 − 1, 후딜), DPS = 공격력 ÷ 공격빈도. 주는 돈은 보물·연구 최대(×3.95, 소수점 버림) 기준이에요. 에이리언은 크리스탈을 다 모은 기준이라, 덜 모았으면 별 없는 에이리언은 최대 7배, 별 에이리언은 최대 16배까지 더 세져요.</p></details>
        </div>
        <div class="panel">
          <h2>능력</h2>
          <ul class="ab-list">${abil.length ? abil.join("") : `<li class="none">특수 능력 없음</li>`}</ul>
        </div>
        <div class="panel" id="eAppear"><h2>등장 스테이지</h2><p class="note" style="margin:0">불러오는 중…</p></div>
      </div>
      <div>
        <div class="panel"><h2>기본 정보</h2><dl class="kv">
          <dt>번호</dt><dd>#${e.id}</dd>
          <dt>기본 체력</dt><dd>${num(e.hp)}</dd>
          <dt>기본 공격력</dt><dd>${e.atk.map(num).join(" + ")}</dd>
          ${e.star ? `<dt>별 에이리언</dt><dd>보물 효과를 덜 받는 에이리언</dd>` : ""}
        </dl>
        <p style="margin:12px 0 0"><a class="btn" href="${dbEnemyUrl(e.id)}" target="_blank" rel="noopener">냥코DB에서 보기 ↗</a></p></div>
        <div class="panel" id="eCounter" hidden></div>
      </div>
    </div>`;
  document.title = `${e.name} - 냥코위키`;
  paintAppear(root, e);
  paintCounter(root, e);
  for (const k of ["hpPct", "atkPct"]) {
    const inp = root.querySelector("#" + k);
    inp.onchange = () => { state[k] = clamp(parseInt(inp.value) || 100, 1, 100000); paint(root, e); root.querySelector("#" + k).focus(); };
  }
}

// 상대하는 캐릭: 적 속성을 타겟으로 엄청 강하다·초 데미지·초극 데미지·맷집·초 맷집을 가진 캐릭.
// 본능(3진부터)으로 생기는 속성·능력도 넣고 "본능"으로 표시한다. 타겟 한정만 있는 캐릭은 뺀다
const COUNTER = [["insane", "초극뎀"], ["massive", "초뎀"], ["tough", "초맷집"], ["strong", "엄강"], ["resist", "맷집"]];
const TAL_COUNTER = { 5: "strong", 6: "resist", 7: "massive" };  // 본능 ID → 능력 (cat.js TAL_FLAG)

// 진화 단계 fi에서 이 속성들에 쓸 수 있는 능력. 본능 없이 되면 tal = false
function counterAt(c, u, fi, traits) {
  const base = (t, ab) => {
    const hit = t.filter(x => traits.includes(x)), keys = COUNTER.filter(([k]) => ab.includes(k));
    return hit.length && keys.length ? { hit, keys } : null;
  };
  const ab = u.forms[fi]?.ab.map(a => a[0]) ?? [], t = c.forms[fi].traits;
  const plain = base(t, ab);
  if (plain || fi < 2 || !c.talents.length) return plain && { ...plain, tal: false };
  const withTal = base([...t, ...c.talents.map(x => x.trait).filter(Boolean)],
                       [...ab, ...c.talents.map(x => TAL_COUNTER[x.id]).filter(Boolean)]);
  return withTal && { ...withTal, tal: true };
}

function paintCounter(root, e) {
  const traits = e.traits.filter(t => GD.traits.includes(t));
  const box = root.querySelector("#eCounter");
  if (!box || !traits.length) return;
  loadUnits().then(units => {
    if (!root.contains(box)) return;
    const list = [];
    for (const c of GD.cats) {
      const u = units[c.id]; if (!u) continue;
      const o = store.owned(c.id), top = c.forms.length - 1;
      const at = c.forms.map((_, fi) => counterAt(c, u, fi, traits));
      const first = at.findIndex(Boolean); if (first < 0) continue;
      // 보유 캐릭은 지금 진화 단계, 아니면 가장 높은 단계 기준
      const cur = o ? Math.min(o.form, top) : top;
      const fi = at[cur] ? cur : at.map(Boolean).lastIndexOf(true);
      const x = at[fi];
      list.push({ c, fi, owned: !!o, need: o && !at[cur] ? first : null, rank: COUNTER.indexOf(x.keys[0]), ...x });
    }
    list.sort((a, b) => a.rank - b.rank || a.c.id - b.c.id);
    const mine = list.filter(x => x.owned), rest = list.filter(x => !x.owned);
    const iconOf = (c, fi) => { for (let f = fi; f >= 0; f--) if (c.forms[f].icon) return `icons/${c.id}_${f}.png`; return null; };
    const row = x => {
      const src = iconOf(x.c, x.fi);
      const tags = [x.hit.join("·"), x.keys.map(k => k[1]).join("·"), x.tal && "본능", x.need != null && `${FORM[x.need]}부터`].filter(Boolean);
      return `<a href="#/cat/${x.c.id}">${src ? `<img class="eicon sm cat" src="${src}" alt="" loading="lazy">` : `<span class="eicon sm ph">#</span>`}
        <span>${esc(x.c.forms[x.fi].name)}<small>${esc(tags.join(" · "))}</small></span></a>`;
    };
    const hasDex = Object.keys(store.data?.cats || {}).length > 0;
    box.hidden = false;
    box.innerHTML = list.length ? `<h2>상대하는 캐릭 <span class="ctl">${list.length}마리</span></h2>
      ${hasDex ? `<h3 class="sum-title">내 캐릭 <small>${mine.length}마리</small></h3>
        ${mine.length ? `<div class="counter-list">${mine.map(row).join("")}</div>` : `<p class="note" style="margin:0">내 도감 캐릭 중에는 없어요.</p>`}` : ""}
      ${rest.length ? `<details class="counter-more"${hasDex ? "" : " open"}><summary>${hasDex ? `보유하지 않은 캐릭 ${rest.length}마리` : `전체 ${rest.length}마리`}</summary>
        <div class="counter-list">${rest.map(row).join("")}</div></details>` : ""}
      <p class="note">${traits.join("·")} 속성을 타겟으로 엄청 강하다·초 데미지·초극 데미지·맷집이 좋다·초 맷집 중 하나라도 가진 캐릭이에요. 강한 능력 순서. "본능"은 본능을 찍어야 생기는 경우, "N진부터"는 내 캐릭이 아직 그 단계가 아닌 경우예요.${hasDex ? "" : ` <a href="#/dex">내 도감</a>을 채우면 보유 캐릭을 먼저 보여줘요.`}</p>`
      : `<h2>상대하는 캐릭</h2><p class="note" style="margin:0">${traits.join("·")} 속성을 타겟으로 하는 캐릭이 없어요.</p>`;
  }).catch(() => {});
}

// 등장 스테이지: 맵마다 몇 번째 스테이지에 나오는지 (분류 순서대로)
function paintAppear(root, e) {
  loadAppear().then(([appear, idx]) => {
    const box = root.querySelector("#eAppear"); if (!box) return;
    const list = appear[e.id] || [];
    const where = new Map();
    idx.categories.forEach((c, ci) => c.maps.forEach(([mid, name]) => where.set(mid, { c, ci, name })));
    const rows = list.map(([mid, sts]) => ({ mid, sts, ...where.get(mid) })).filter(r => r.c).sort((a, b) => a.ci - b.ci || a.mid - b.mid);
    const total = rows.reduce((n, r) => n + r.sts.length, 0);
    const LIMIT = 30, more = rows.length > LIMIT;
    const html = list => list.map(r => `<li><small>${esc(r.c.name)}</small><a href="#/stage/${r.mid}">${esc(r.name)}</a>
      <span>${r.sts.map(i => `<a href="#/stage/${r.mid}/${i}">${i + 1}</a>`).join(" ")}</span></li>`).join("");
    box.innerHTML = rows.length ? `<h2>등장 스테이지 <span class="ctl">${rows.length}개 맵 · ${total}스테이지</span></h2>
      <ul class="appear">${html(rows.slice(0, LIMIT))}</ul>
      ${more ? `<button class="btn" id="eMore">${rows.length - LIMIT}개 맵 더 보기</button>` : ""}`
      : `<h2>등장 스테이지</h2><p class="note" style="margin:0">한국판 스테이지 데이터에서 찾지 못했어요.</p>`;
    box.querySelector("#eMore")?.addEventListener("click", ev => { box.querySelector(".appear").innerHTML = html(rows); ev.target.remove(); });
  }).catch(() => {});
}
