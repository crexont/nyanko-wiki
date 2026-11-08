// 아이템 — 스테이지 드롭으로 얻는 아이템 목록(#/items)과 아이템별 드롭 스테이지 효율(#/item/<id>).
// 데이터: tools/build_items.py → data/items.json (반복 클리어 1번 기대 개수·첫 클리어 보상·통솔력 칸 값·스테이지 이름)
// NP효율(#/np)도 이 메뉴 안에 있다.
import { esc, have, store } from "./common.js";
import { loadIndex } from "./stage.js";
import { loadSchedule, openNow } from "./schedule.js";

let itemsPromise;
const loadItems = () => itemsPromise ??= fetch("data/items.json").then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });

const ITEM_COST = 100000;  // 통솔력 칸이 이 이상이면 아이템 입장 (아이템 × 1000 + 개수)
const DRINK_MAPS = 14;     // 맵 번호 앞자리 14 = 고양이 드링크 스테이지: 통솔력 칸이 드링크 (종류 × 1000 + 개수)
const DRINKS = ["고양이 드링크A", "고양이 드링크B", "고양이 드링크C"];
// 데이터에 1회 표시가 없지만 스테이지(층·단)마다 한 번만 받는 분류: 풍운 냥코탑(열릴 때마다 초기화)·냥코도 승단 시험 (사용자 확인)
const ONCE_MAPS = new Set([7, 37]);
const MAP_ITEM = 25;       // 맵 번호 앞자리 25 = 고전장: 지도 아이템을 써서 여는 맵
// 언제든 갈 수 있는 분류 (메인 스토리·레전드·좀비·고전장·냥코탑·마계편·미궁)
const ALWAYS = new Set([3, 20, 21, 22, 23, 0, 13, 34, 25, 7, 30, 33]);

// 목록 묶음: [제목, 아이템 번호]. 여기 없는 번호는 "이벤트 티켓·기타"
const GROUPS = [
  ["티켓·재화", [6, 20, 21, 22, 145, 155, 156, 157, 105]],
  ["진화 재료: 개다래", [30, 31, 32, 33, 34, 41, 43, 160, 164, 35, 36, 37, 38, 39, 40, 42, 44, 161]],
  ["진화 재료: 수석", [167, 168, 169, 170, 171, 184]],
  ["캣츠아이", [50, 51, 52, 53, 54, 58]],
  ["전투 아이템·드링크", [0, 1, 2, 3, 4, 5, 55, 56, 57]],
  ["가마토토 재료", [85, 86, 87, 88, 89, 90, 91, 140]],
];

const icon = (d, id) => d.noIcon.includes(id) ? `<span class="item-ic no-ic" aria-hidden="true">?</span>`
  : `<img class="item-ic" src="icons/items/${id}.png" alt="" loading="lazy">`;
const fmtN = (v, dig = 2) => v.toLocaleString("ko-KR", { maximumFractionDigits: v >= 100 ? 0 : v >= 10 ? 1 : dig });
const failed = root => { root.innerHTML = `<div class="empty">아이템 데이터를 불러오지 못했어요. 잠시 뒤 새로고침해 주세요.</div>`; };

// ---- 목록 ----
const ui = { q: "" };
export function renderItems(root) {
  root.innerHTML = `
    <p class="crumb"><a href="#/">냥코위키</a><i>/</i><span>아이템</span></p>
    <div class="page-head"><div><h1>아이템</h1><p>스테이지에서 얻는 아이템. 누르면 드롭 스테이지를 통솔력 효율 순으로 볼 수 있어요.</p></div></div>
    <a class="it-np" href="#/np"><img src="icons/items/7.png" alt=""><span><b>NP효율</b><small>뽑기·강습·지도·티켓 스테이지마다 NP를 얼마나 얻는지 비교</small></span><i>›</i></a>
    <div class="filters"><div class="row"><input type="search" id="iQ" placeholder="아이템 이름 검색" value="${esc(ui.q)}" autocomplete="off"></div></div>
    <div id="iList"><div class="empty">불러오는 중…</div></div>`;
  let draw = null;
  loadItems().then(d => {
    const ids = Object.keys(d.drops).map(Number);
    const grouped = new Set(GROUPS.flatMap(([, l]) => l));
    const groups = [...GROUPS.map(([t, l]) => [t, l.filter(i => d.drops[i])]), ["이벤트 티켓·기타", ids.filter(i => !grouped.has(i))]];
    const inv = !!store.data?.inv;
    draw = () => {
      const q = ui.q.trim().toLowerCase();
      const html = groups.map(([t, l]) => {
        const shown = l.filter(i => !q || d.names[i].toLowerCase().includes(q));
        return shown.length ? `<div class="panel"><h2>${t} <span class="ctl">${shown.length}종</span></h2><div class="it-grid">${shown.map(i =>
          `<a href="#/item/${i}">${icon(d, i)}<span><b>${esc(d.names[i])}</b><small>${d.drops[i].length}곳${inv && have(i) ? ` · 보유 ${have(i).toLocaleString()}` : ""}</small></span></a>`).join("")}</div></div>` : "";
      }).join("");
      root.querySelector("#iList").innerHTML = html || `<div class="empty">"${esc(ui.q.trim())}"에 맞는 아이템이 없어요.</div>`;
    };
    root.querySelector("#iQ").addEventListener("input", e => { ui.q = e.target.value; draw(); });
    draw();
  }).catch(() => failed(root.querySelector("#iList")));
  return () => draw?.();
}

// ---- 상세: 드롭 스테이지 효율 ----
const opt = { now: false, old: false, more: {} };
// 받는 방식 구분 (켜고 끄기, 이 브라우저에 기억)
const KIND = { rep: "무한 반복", open: "열릴 때마다 1회", one: "1회성" };
const KIND_TIP = { rep: "통솔력만 있으면 몇 번이든 돌 수 있는 곳", open: "한 번 받으면 끝이지만 그 맵이 다시 열리면(재개최·고전장 지도) 또 받을 수 있는 곳",
  one: "계정에서 딱 한 번만 받는 보상" };
const KINDS_KEY = "nyanko-wiki.itemKinds";
const kinds = (() => { try { return { rep: true, open: true, one: true, ...JSON.parse(localStorage.getItem(KINDS_KEY)) }; } catch { return { rep: true, open: true, one: true }; } })();
const saveKinds = () => { try { localStorage.setItem(KINDS_KEY, JSON.stringify(kinds)); } catch {} };
const LIMIT = 50;

// 맵 → 지금 상태: { open: 끝 시각 | true, next: 다음 시작 시각 }
function mapStatus(sched, now) {
  const st = new Map();
  for (const e of sched?.sale || []) for (const m of e.maps) {
    const s = st.get(m) || {};
    if (openNow(e, now)) s.open = e.end || true;
    else if (e.start && Date.parse(e.start) > now && (!s.next || e.start < s.next)) s.next = e.start;
    else if (!s.open && (!e.end || Date.parse(e.end) > now)) s.later = true;  // 기간 안이지만 요일·시간이 아님
    st.set(m, s);
  }
  return st;
}
const md = iso => { const d = new Date(Date.parse(iso) + 9 * 36e5); return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`; };
function statusHtml(r) {
  if (r.s?.open) return `<span class="it-st on" title="${r.s.open === true ? "" : `~${md(r.s.open)}`}">지금 열림</span>`;
  if (r.always) return `<span class="it-st">상시</span>`;
  if (r.s?.later) return `<span class="it-st">요일·시간</span>`;
  if (r.s?.next) return `<span class="it-st">${md(r.s.next)}부터</span>`;
  return `<span class="it-st off">열릴 때만</span>`;
}
const canGo = r => r.s?.open || r.always;

function costText(d, idx, r) {
  const e = r.energy;
  if (e == null) return "-";
  if (e >= ITEM_COST) return `${idx.items?.[Math.floor(e / 1000)] ?? d.names[Math.floor(e / 1000)] ?? "아이템"} ${e % 1000}개`;
  if (r.drink) return `${DRINKS[Math.floor(e / 1000)] ?? "드링크"} ${e % 1000}개`;
  return `통솔력 ${e}`;
}

export function renderItem(root, id) {
  root.innerHTML = `<div class="empty">불러오는 중…</div>`;
  let draw = null;
  Promise.all([loadItems(), loadIndex(), loadSchedule().catch(() => null)]).then(([d, idx, sched]) => {
    const list = d.drops[id];
    if (!list) { root.innerHTML = `<div class="empty">아이템을 찾을 수 없어요. <a href="#/items">아이템 목록으로</a></div>`; return; }
    const where = new Map(idx.categories.flatMap(c => c.maps.map(([mid, n]) => [mid, { c: c.name, n }])));
    const now = Date.now(), status = mapStatus(sched, now);
    // 스테이지 한 줄을 받는 방식별 항목으로 나눈다 (맵 옵션: [보상 초기화 종류, 1회 표시], tools/build_items.py)
    //   rep  = 무한 반복 (클리어할 때마다 확률로)
    //   open = 열릴 때마다 1회 (초기화 1·2·3), 고전장 지도 맵은 지도 1장당 1회
    //   one  = 1회성 (초기화 없음)
    // 1회 표시가 있는 맵(+ 냥코탑·승단 시험)은 스테이지 자체를 한 번만 깰 수 있어서 반복 드롭까지 그 한 번에 받는 것으로 본다
    const entries = [];
    for (const [mid, si, per, once, energy, sname] of list) {
      const w = where.get(mid);
      if (!w) continue;
      const pre = Math.floor(mid / 1000), drink = pre === DRINK_MAPS;
      const [reset = 0, flag0 = 0] = d.maps?.[mid] || [], flag = flag0 || ONCE_MAPS.has(pre);
      const paid = energy > 0 && energy < ITEM_COST && !drink;  // 통솔력으로 들어가는 스테이지
      const base = { mid, si, energy, sname, drink, reset, paid, c: w.c, n: w.n, s: status.get(mid), always: ALWAYS.has(pre) };
      const eff = amt => paid ? amt * 1000 / energy : null;
      if (flag) {
        const byMap = !reset && pre === MAP_ITEM;
        entries.push({ ...base, kind: reset || byMap ? "open" : "one", byMap, amt: per + once, eff: eff(per + once) });
      } else {
        if (per > 0) entries.push({ ...base, kind: "rep", amt: per, eff: eff(per) });
        if (once > 0) entries.push({ ...base, kind: reset ? "open" : "one", amt: once, first: true, eff: eff(once) });
      }
    }
    // 한 맵에 이름이 같은 스테이지가 여러 개면 몇 번째인지 붙인다
    const dup = new Map(), key = r => `${r.mid}|${r.si}`, nkey = r => `${r.mid}|${r.sname}`;
    for (const r of new Map(entries.map(r => [key(r), r])).values()) dup.set(nkey(r), (dup.get(nkey(r)) || 0) + 1);
    for (const r of entries) if (dup.get(nkey(r)) > 1) r.label = `${r.sname} (${r.si + 1}번째)`;
    const nStages = new Set(entries.map(key)).size;
    const count = k => entries.filter(r => r.kind === k && (opt.old || !r.n.includes("(옛 버전)"))).length;
    const name = d.names[id];
    draw = () => {
      // 통솔력 1000당이 있는 줄(통솔력 스테이지)을 위에 효율 순으로, 나머지(드링크·아이템 입장·통솔력 0)는 개수 순으로 아래에
      const rs = entries.filter(r => kinds[r.kind] && (opt.old || !r.n.includes("(옛 버전)")) && (!opt.now || canGo(r)))
        .sort((a, b) => (b.eff ?? -1) - (a.eff ?? -1) || b.amt - a.amt);
      const shown = opt.more.all ? rs : rs.slice(0, LIMIT);
      const stageCell = r => `<td><small>${esc(r.c)}</small><a href="#/stage/${r.mid}/${r.si}">${esc(r.n)} · ${esc(r.label || r.sname)}</a></td>`;
      const kindCell = r => `<td><span class="it-tag ${r.kind}">${KIND[r.kind]}</span>${r.byMap ? `<small class="it-first">지도 1장당</small>`
        : r.kind === "rep" && r.reset === 3 ? `<small class="it-first" title="열릴 때마다 도전 횟수가 초기화되는 맵이에요">도전 횟수 제한</small>`
        : r.first ? `<small class="it-first">1회 한정 보상</small>` : r.kind !== "rep" ? `<small class="it-first">스테이지 1번 클리어</small>` : ""}</td>`;
      const owned = store.data?.inv ? have(id) : null;
      root.innerHTML = `
        <p class="crumb"><a href="#/">냥코위키</a><i>/</i><a href="#/items">아이템</a><i>/</i><span>${esc(name)}</span></p>
        <div class="page-head it-head"><div>${icon(d, id)}<h1>${esc(name)}</h1><p>드롭 스테이지 ${nStages}곳${owned != null ? ` · 내 보유 ${owned.toLocaleString()}개` : ""}</p></div></div>
        ${id === 7 || id === 6 ? `<p class="note"><a href="#/np">NP효율</a> 페이지에서 ${id === 6 ? "XP 스테이지 효율(보물·광고 배율 포함)도" : "NP"} 볼 수 있어요.</p>` : ""}
        <div class="filters">
          <div class="row it-kinds">${Object.entries(KIND).map(([k, l]) =>
            `<button class="chip it-kind k-${k}" data-kind="${k}" aria-pressed="${!!kinds[k]}" title="${esc(KIND_TIP[k])}">${l} <small>${count(k)}</small></button>`).join("")}</div>
          <div class="row">
            <button class="chip" data-opt="now" aria-pressed="${opt.now}">지금 갈 수 있는 곳만</button>
            <button class="chip" data-opt="old" aria-pressed="${opt.old}">옛 버전 맵 포함</button>
            ${sched ? "" : `<small class="note">일정 데이터를 못 불러와서 "지금 열림"을 알 수 없어요.</small>`}</div></div>
        ${rs.length ? `<div class="panel"><h2>드롭 스테이지 <span class="ctl">${rs.length}곳</span></h2>
          <div class="table-wrap"><table class="sum-table it-table"><thead><tr><th>스테이지</th><th>구분</th><th>상태</th><th>입장</th><th>받는 개수</th><th>통솔력 1000당</th></tr></thead><tbody>
          ${shown.map(r => `<tr${canGo(r) ? ` class="go"` : ""}>${stageCell(r)}${kindCell(r)}<td>${statusHtml(r)}</td><td>${esc(costText(d, idx, r))}</td>
            <td>${r.kind === "rep" || !r.first ? "기대 " : ""}${fmtN(r.amt)}개</td><td>${r.eff != null ? `<b>${fmtN(r.eff)}</b>` : "-"}</td></tr>`).join("")}</tbody></table></div>
          ${rs.length > shown.length ? `<button class="btn it-more" data-more>나머지 ${rs.length - shown.length}곳 더 보기</button>` : ""}</div>`
          : `<div class="empty">조건에 맞는 스테이지가 없어요. 위에서 구분을 켜 보세요.</div>`}
        <p class="note">무한 반복의 받는 개수는 한 번 클리어할 때 기대값, 통솔력 1000당 = 받는 개수 × 1000 ÷ 통솔력이에요 (1회 한정 보상은 그 줄만큼 한 번). 상태: 지금 열림 = 서버 일정 기준 지금 열린 맵, 상시 = 메인·레전드 스토리 등 언제든 갈 수 있는 맵, 요일·시간 = 기간 안이지만 지금 시간대가 아님. 확률은 게임 데이터 그대로이고, 보물·트레저 레이더 효과는 넣지 않았어요.</p>`;
      root.querySelectorAll("[data-kind]").forEach(b => b.onclick = () => { kinds[b.dataset.kind] = !kinds[b.dataset.kind]; saveKinds(); draw(); });
      root.querySelectorAll("[data-opt]").forEach(b => b.onclick = () => { opt[b.dataset.opt] = !opt[b.dataset.opt]; draw(); });
      root.querySelector("[data-more]")?.addEventListener("click", () => { opt.more.all = true; const y = scrollY; draw(); scrollTo(0, y); });
    };
    opt.more = {};
    draw();
    document.title = `${name} - 냥코위키`;
  }).catch(() => failed(root));
  return () => draw?.();
}
