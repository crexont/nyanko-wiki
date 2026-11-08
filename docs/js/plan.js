// 육성 — 보유 재화·재료 + 진화 육성 계획 (필요 재료 합계·부족분)
import { GD, BYID, FORM, esc, icon, store, view, itemName, itemIcon, have, haveXp, toast, orbInfo, ORB_GRADE, levelCost, clamp } from "./common.js";

const CURRENCY = [["xp", "경험치"], ["np", "NP"], ["catfood", "통조림"], ["normalTickets", "냥코 티켓"],
                  ["rareTickets", "레어 티켓"], ["platinumTickets", "플래티넘 티켓"], ["legendTickets", "레전드 티켓"]];
const STEP = { tf: "3진", ff: "4진", lv: "레벨" };

// 보유 재료 묶음: Matatabi 그룹 9 = 수석, 나머지 = 개다래. 캐츠아이는 따로.
function itemGroups() {
  const m = GD.matatabi || [];
  return [
    ["개다래 열매", m.filter(([, seed, g]) => !seed && g < 9).map(([id]) => id)],
    ["개다래나무의 씨앗", m.filter(([, seed, g]) => seed && g < 9).map(([id]) => id)],
    ["수석", m.filter(([, , g]) => g === 9).map(([id]) => id)],
    ["캐츠아이", GD.catseyes || []],
  ];
}

// 계획 하나의 비용·상태
function planEntry(p) {
  const c = BYID.get(p.id); if (!c) return null;
  if (p.step === "lv") {  // 목표 레벨까지 레벨업: 지금 레벨(미보유면 1)부터
    const o = store.owned(p.id), from = o ? o.level : 1, done = !!o && o.level >= p.to;
    return { p, c, o, fi: o ? Math.min(o.form, c.forms.length - 1) : 0, cost: done ? null : levelCost(c, from, p.to),
             status: done ? "목표 달성" : o ? null : "미보유 (Lv1부터 계산)", cls: done ? "done" : "", done,
             label: `Lv${from} → Lv${p.to}` };
  }
  const o = store.owned(p.id), cost = p.step === "tf" ? c.tfCost : c.ffCost;
  const need = p.step === "tf" ? c.tfLevel : c.ffLevel, target = p.step === "tf" ? 2 : 3;
  let status, cls = "";
  if (o && o.form >= target) { status = "진화 완료"; cls = "done"; }
  else if (!o) status = "미보유";
  else if (o.form < target - 1) status = `${FORM[target - 1]} 먼저`;
  else if (need > 0 && o.level < need) status = `Lv${need} 필요 (현재 ${o.level})`;
  else if (!cost) status = "스테이지 클리어로 진화";
  else status = null;  // 재료만 남음 → 합계로 판단
  return { p, c, o, fi: target, cost, status, cls, done: cls === "done", label: STEP[p.step] };
}

export function renderPlan(root) {
  root.innerHTML = `
    <p class="crumb"><a href="#/">냥코위키</a><i>/</i><span>육성</span></p>
    <div class="page-head">
      <div><h1>육성</h1><p>보유 재화·재료와 육성 계획. 진화하거나 레벨을 올릴 캐릭을 담으면 필요한 경험치·재료·캣츠아이 합계와 부족분을 계산해요.</p></div>
      <div class="acts"><label class="btn primary">세이브 불러오기<input type="file" accept=".json,application/json" hidden data-import></label></div>
    </div>
    <p class="meta" id="pMeta"></p>
    <div class="cols">
      <div>
        <div class="panel"><h2>육성 계획</h2>
          <div class="row" style="margin-bottom:12px">
            <input type="search" id="pAdd" list="pAddList" placeholder="진화시킬 캐릭 이름 (3진·4진 이름으로 검색)">
            <datalist id="pAddList"></datalist>
            <button class="btn" id="pAddBtn">계획에 담기</button>
          </div>
          <div class="row" style="margin-bottom:12px">
            <input type="search" id="pLv" list="pLvList" placeholder="레벨업할 캐릭 이름">
            <datalist id="pLvList"></datalist>
            <input type="number" id="pTo" min="2" max="60" placeholder="목표 Lv" style="width:96px">
            <button class="btn" id="pLvBtn">레벨 목표 담기</button>
          </div>
          <div id="pList"></div>
          <div id="pSum"></div>
        </div>
        <div class="panel" id="pDrop"><h2>재료 드롭 스테이지</h2>
          <div class="drop-pick" id="pDropPick"></div>
          <div id="pDropList"><p class="note" style="margin:0">재료를 고르면 그 재료가 나오는 스테이지를 확률 높은 순으로 보여줘요.</p></div></div>
        <div class="panel"><h2>지금 바로 진화 가능</h2>
          <p class="note" style="margin:0 0 10px">캐릭마다 따로 계산한 결과예요. 경험치·열매는 함께 쓰니까, 여러 마리를 진화시킬 땐 계획에 담아 합계를 확인하세요.</p>
          <div id="pReady"></div></div>
      </div>
      <div>
        <div class="panel"><h2>재화</h2><div class="inv-grid wide" id="pCur"></div></div>
        <div class="panel"><h2>보유 재료</h2><div id="pItems"></div>
          <p class="note">세이브를 불러오면 채워지고, 직접 고쳐도 돼요. 숫자를 바꾸면 바로 저장돼요.</p></div>
        <div class="panel"><h2>보유 본능옥</h2><div id="pOrbs"></div></div>
      </div>
    </div>`;

  // 계획에 담기: 3진/4진 이름 → {id, step}. 이미 그 단계까지 진화한 보유 캐릭은 뺀다
  const opts = new Map();
  const fillOpts = () => {
    opts.clear();
    for (const c of GD.cats) {
      const form = store.owned(c.id)?.form ?? -1;
      if (c.tfLevel != null && c.forms[2] && form < 2) opts.set(`${c.forms[2].name} (3진)`, { id: c.id, step: "tf" });
      if (c.ffLevel != null && c.forms[3] && form < 3) opts.set(`${c.forms[3].name} (4진)`, { id: c.id, step: "ff" });
    }
    root.querySelector("#pAddList").innerHTML = [...opts.keys()].map(k => `<option value="${esc(k)}">`).join("");
    // 레벨업: 보유 캐릭은 지금 진화 단계 이름, 미보유는 마지막 단계 이름
    lvOpts.clear();
    for (const c of GD.cats) {
      const o = store.owned(c.id), f = c.forms[o ? Math.min(o.form, c.forms.length - 1) : c.forms.length - 1];
      lvOpts.set(`${f.name}${o ? ` (Lv${o.level})` : ""}`, c.id);
    }
    root.querySelector("#pLvList").innerHTML = [...lvOpts.keys()].map(k => `<option value="${esc(k)}">`).join("");
  };
  const lvOpts = new Map();
  const addLv = () => {
    const inp = root.querySelector("#pLv"), id = lvOpts.get(inp.value.trim()), to = parseInt(root.querySelector("#pTo").value);
    if (id == null) return toast("목록에서 캐릭을 골라 주세요.");
    if (!(to > 1)) return toast("목표 레벨을 입력해 주세요.");
    addToPlan(id, "lv", to); inp.value = "";
  };
  root.querySelector("#pLvBtn").onclick = addLv;
  root.querySelector("#pTo").onkeydown = e => { if (e.key === "Enter") addLv(); };
  const add = () => {
    const inp = root.querySelector("#pAdd"), v = opts.get(inp.value.trim());
    if (!v) return toast("목록에서 캐릭을 골라 주세요.");
    addToPlan(v.id, v.step); inp.value = "";
  };
  root.querySelector("#pAddBtn").onclick = add;
  root.querySelector("#pAdd").onkeydown = e => { if (e.key === "Enter") add(); };

  // 재화·재료 직접 수정: 저장만 하고 화면 전체는 다시 그리지 않는다 (입력 중 포커스 유지)
  root.addEventListener("change", e => {
    const t = e.target;
    if (!t.matches("[data-cur], [data-item]")) return;
    const inv = store.ensureInv(), n = Math.max(0, parseInt(t.value) || 0);
    if (t.dataset.cur) inv.currency[t.dataset.cur] = n; else inv.items[t.dataset.item] = n;
    inv.updatedAt = new Date().toISOString();
    t.value = n;
    store.persist(true);
    renderPlanParts();
  });
  root.addEventListener("click", e => {
    const rm = e.target.closest("[data-rm]");
    if (rm) { const d = store.ensure(); d.plan = (d.plan || []).filter((_, i) => i !== +rm.dataset.rm); store.persist(); }
  });

  const refresh = () => { fillOpts(); renderInv(); renderPlanParts(); renderDropPick(); };
  root.addEventListener("click", e => {
    const b = e.target.closest("[data-drop]");
    if (b) { dropSel = +b.dataset.drop; renderDropPick(); renderDropList(); if (b.closest("#pSum")) root.querySelector("#pDrop").scrollIntoView({ behavior: "smooth" }); }
  });
  refresh();
  return refresh;
}

export function addToPlan(id, step, to) {
  const d = store.ensure();
  d.plan ??= [];
  const c = BYID.get(id);
  if (step === "lv") {  // 레벨 목표는 캐릭마다 하나: 이미 있으면 목표만 바꾼다
    to = clamp(to | 0, 2, c.maxLevel);
    const cur = d.plan.find(p => p.id === id && p.step === "lv");
    if (cur) cur.to = to; else d.plan.push({ id, step, to });
    store.persist();
    return toast(`${c.forms[c.forms.length - 1].name} Lv${to}까지 레벨업을 육성 계획에 담았어요.`);
  }
  if (d.plan.some(p => p.id === id && p.step === step)) return toast("이미 계획에 있어요.");
  d.plan.push({ id, step });
  store.persist();
  toast(`${c.forms[step === "tf" ? 2 : 3].name} ${STEP[step]}을 육성 계획에 담았어요.`);
}
export function removeFromPlan(id, step) {
  const d = store.ensure();
  d.plan = (d.plan || []).filter(p => !(p.id === id && p.step === step));
  store.persist();
}
export const inPlan = (id, step) => !!store.data?.plan?.some(p => p.id === id && p.step === step);

function renderInv() {
  const inv = store.data?.inv, cur = inv?.currency || {};
  const meta = document.getElementById("pMeta"); if (!meta) return;
  const fmt = s => s ? String(s).slice(0, 16).replace("T", " ") : null;
  meta.textContent = inv
    ? [inv.saveModified && `재화 기준: 세이브 ${fmt(inv.saveModified)}`, inv.updatedAt && `마지막 수정 ${fmt(new Date(inv.updatedAt).toLocaleString("sv"))}`].filter(Boolean).join(" · ")
    : "아직 재화 정보가 없어요. 세이브를 불러오거나(추출 도구 v2.0 이상) 아래에 직접 입력하세요.";
  // 재화·재료 칸: 이름 대신 게임 아이콘 (이름은 마우스를 올리면)
  document.getElementById("pCur").innerHTML = CURRENCY.map(([k, label]) =>
    `<label title="${label}">${itemIcon(GD.currencyItems[k], label)}<input type="number" min="0" inputmode="numeric" data-cur="${k}" value="${cur[k] ?? 0}"></label>`).join("");
  document.getElementById("pItems").innerHTML = itemGroups().map(([title, ids]) => ids.length ? `
    <div class="inv-group"><small>${title}</small><div class="inv-grid">${ids.map(id =>
      `<label title="${esc(itemName(id))}">${itemIcon(id)}<input type="number" min="0" inputmode="numeric" data-item="${id}" value="${have(id)}"></label>`).join("")}</div></div>` : "").join("");
  // 본능옥: 세이브에서 읽은 그대로 (장착 정보는 세이브에서 못 읽어서 캐릭터 상세에서 직접 고른다)
  const orbs = Object.entries(inv?.orbs || {}).map(([id, n]) => [orbInfo(+id), n]).filter(([o, n]) => o && n > 0)
    .sort(([a], [b]) => a.content - b.content || a.attr - b.attr || b.grade - a.grade);
  document.getElementById("pOrbs").innerHTML = orbs.length
    ? `<ul class="orb-list">${orbs.map(([o, n]) => `<li><span class="orb-g g${o.grade}">${ORB_GRADE[o.grade]}</span>${esc(o.label.replace(/ [DCBAS]$/, ""))}<b>×${n}</b></li>`).join("")}</ul>
       <p class="note">어느 캐릭에 장착했는지는 세이브에서 읽을 수 없어요. 캐릭터 상세에서 직접 골라 스탯을 확인하세요.</p>`
    : `<p class="note" style="margin:0">${inv ? "보유한 본능옥이 없어요." : "세이브를 불러오면 보여요."}</p>`;
}

function renderPlanParts() {
  const list = document.getElementById("pList"); if (!list) return;
  const entries = (store.data?.plan || []).map(planEntry).map((e, i) => e && { ...e, i }).filter(Boolean);
  list.innerHTML = entries.length ? `<div class="plan-list">${entries.map(e => `
      <div class="plan-row ${e.cls}">
        <a href="#/cat/${e.c.id}">${icon(e.c, e.fi)}</a>
        <div class="body"><a class="name" href="#/cat/${e.c.id}">${esc(e.c.forms[e.fi].name)}</a>
          <div class="sub"><span class="form">${esc(e.label)}</span>${e.status ? `<span>${esc(e.status)}</span>` : ""}${!e.done && e.cost && (e.p.step === "lv" || !e.status) ? costText(e.cost) : ""}${e.cost?.est ? `<span class="est" title="51레벨 이상 경험치는 추정값">추정 포함</span>` : ""}</div></div>
        <button class="mini" data-rm="${e.i}" title="계획에서 빼기">빼기</button>
      </div>`).join("")}</div>`
    : `<p class="note" style="margin:0">아직 담은 캐릭이 없어요. 위에서 검색하거나 캐릭터 상세의 [육성 계획에 담기]를 누르세요.</p>`;

  // 필요 재료 합계 (완료·미보유 등 상태와 상관없이 아직 안 끝난 계획은 모두 합산)
  const need = new Map(); let xp = 0;
  for (const e of entries) {
    if (e.done || !e.cost) continue;
    xp += e.cost.xp;
    for (const [id, n] of e.cost.items) need.set(id, (need.get(id) || 0) + n);
  }
  const rows = [[GD.currencyItems.xp, "경험치", xp, haveXp()], ...[...need].map(([id, n]) => [id, itemName(id), n, have(id)])].filter(r => r[2] > 0);
  const lack = rows.filter(([, , n, h]) => h < n).length;
  document.getElementById("pSum").innerHTML = rows.length ? `
    <h3 class="sum-title">필요 재료 합계 ${lack ? `<span class="tag todo">${lack}종 부족</span>` : `<span class="tag ready">전부 충분</span>`}</h3>
    <table class="sum-table"><thead><tr><th>재료</th><th>필요</th><th>보유</th><th>부족</th></tr></thead><tbody>
    ${rows.map(([id, name, n, h]) => `<tr class="${h < n ? "lack" : ""}"><td class="item-cell">${itemIcon(id, name)}${esc(name)}${h < n && id !== GD.currencyItems.xp ? ` <button class="mini" data-drop="${id}">드롭</button>` : ""}</td><td>${n.toLocaleString()}</td><td>${h.toLocaleString()}</td><td>${h < n ? (n - h).toLocaleString() : "-"}</td></tr>`).join("")}
    </tbody></table>
    ${store.data?.inv ? "" : `<p class="note">보유량이 0으로 계산됐어요. 재화·재료를 불러오거나 입력하세요.</p>`}` : "";

  // 지금 바로 진화 가능 (보유 캐릭 중 레벨·재료 모두 충족)
  const ready = GD.cats.map(view).filter(v => v.tfReady || v.ffReady);
  document.getElementById("pReady").innerHTML = !store.data?.inv
    ? `<p class="note" style="margin:0">재화·재료 정보가 있어야 알 수 있어요.</p>`
    : ready.length ? `<div class="plan-list">${ready.map(v => {
        const step = v.tfReady ? "tf" : "ff", e = v[step];
        return `<div class="plan-row"><a href="#/cat/${v.c.id}">${icon(v.c, v.fi)}</a>
          <div class="body"><a class="name" href="#/cat/${v.c.id}">${esc(v.c.forms[v.fi].name)}</a>
            <div class="sub"><span class="tag ready">${STEP[step]} 바로 가능</span>${costText(e.cost)}</div></div>
          ${inPlan(v.c.id, step) ? "" : `<button class="mini" data-plan="${v.c.id}:${step}">계획에 담기</button>`}</div>`;
      }).join("")}</div>`
    : `<p class="note" style="margin:0">지금 재료로 바로 진화할 수 있는 캐릭이 없어요.</p>`;
  document.querySelectorAll("#pReady [data-plan]").forEach(b => b.onclick = () => { const [id, s] = b.dataset.plan.split(":"); addToPlan(+id, s); });
}

const costText = cost => cost ? `<span class="cost-ic">${cost.xp ? `<b>${itemIcon(GD.currencyItems.xp, "경험치")}${cost.xp.toLocaleString()}</b>` : ""}${cost.items.map(([id, n]) => `<b>${itemIcon(id)}×${n}</b>`).join("")}</span>` : "";

// ---- 재료 드롭 스테이지 (docs/data/stages/item_drops.json) ----
let dropSel = null, dropsPromise;
const loadItemDrops = () => dropsPromise ??= Promise.all([
  fetch("data/stages/item_drops.json").then(r => r.json()),
  fetch("data/stages/index.json").then(r => r.json()),
]);
const materialIds = () => itemGroups().flatMap(([, ids]) => ids);

function renderDropPick() {
  const box = document.getElementById("pDropPick"); if (!box) return;
  box.innerHTML = materialIds().map(id => `<button class="drop-chip" data-drop="${id}" aria-pressed="${id === dropSel}" title="${esc(itemName(id))}">${itemIcon(id)}</button>`).join("");
}

function renderDropList() {
  const box = document.getElementById("pDropList"); if (!box || dropSel == null) return;
  box.innerHTML = `<p class="note" style="margin:0">불러오는 중…</p>`;
  loadItemDrops().then(([drops, idx]) => {
    const where = new Map(idx.categories.flatMap(c => c.maps.map(([mid, n]) => [mid, { c: c.name, n }])));
    const list = (drops[dropSel] || []).map(([mid, si, ch, all, sname, energy]) => ({ mid, si, ch: all ? 100 : ch, all, sname, energy, ...where.get(mid) }))
      .filter(r => r.n).sort((a, b) => (b.ch ?? 0) - (a.ch ?? 0) || (a.energy ?? 999) - (b.energy ?? 999));
    const fresh = list.filter(r => !r.n.includes("(옛 버전)"));
    const LIMIT = 40;
    box.innerHTML = `<h3 class="sum-title">${itemIcon(dropSel)}${esc(itemName(dropSel))} <small>${fresh.length}곳 · <a href="#/item/${dropSel}">통솔력 효율로 보기 ›</a></small></h3>
      ${fresh.length ? `<div class="table-wrap"><table class="sum-table drop-table"><thead><tr><th>스테이지</th><th>확률</th><th>통솔력</th></tr></thead><tbody>
        ${fresh.slice(0, LIMIT).map(r => `<tr><td><small>${esc(r.c)}</small><a href="#/stage/${r.mid}/${r.si}">${esc(r.n)} · ${esc(r.sname)}</a></td>
          <td>${r.all ? "확정" : r.ch != null ? `${r.ch}%` : "-"}</td><td>${r.energy ?? "-"}</td></tr>`).join("")}
      </tbody></table></div>${fresh.length > LIMIT ? `<p class="note">확률 높은 ${LIMIT}곳만 보여줘요.</p>` : ""}`
      : `<p class="note" style="margin:0">이 재료를 드롭하는 스테이지를 찾지 못했어요.</p>`}
      <p class="note">이벤트·요일 스테이지는 열려 있는 기간에만 갈 수 있어요. 확률은 한 번 클리어했을 때 기준이에요.</p>`;
  }).catch(() => { box.innerHTML = `<p class="note" style="margin:0">드롭 데이터를 불러오지 못했어요.</p>`; });
}
