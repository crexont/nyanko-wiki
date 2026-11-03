// 일정 — 게임 서버 이벤트 데이터(스테이지·뽑기·아이템). tools/schedule.py 가 만든 JSON을
// GitHub Actions가 schedule-data 브랜치에 올리고, 사이트는 그걸 읽는다 (로컬 미리보기는 data/schedule.json).
// 화면: 오늘(남은 시간·오늘 시간표·곧 시작) / 달력 / 목록. 내 도감이 있으면 없는 캐릭을 얻을 수 있는 일정을 표시한다.
import { GD, BYID, esc, icon, store } from "./common.js";
import { loadIndex } from "./stage.js";

const LOCAL = /^(localhost|127\.|\[::1\])/.test(location.hostname);
const SRC = LOCAL ? "data/schedule.json" : "https://raw.githubusercontent.com/crexont/nyanko-wiki/schedule-data/schedule.json";
let dataPromise, setsPromise, dropsPromise;
const loadSchedule = () => dataPromise ??= fetch(SRC, { cache: "no-cache" }).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
const loadSets = () => setsPromise ??= fetch("data/gatya_sets.json").then(r => r.json());
const loadDrops = () => dropsPromise ??= fetch("data/stages/cat_drops.json").then(r => r.json());

const DAY = 864e5;
const WEEK = ["일", "월", "화", "수", "목", "금", "토"];  // 요일 비트: 1 = 일요일 … 64 = 토요일
const KST = 9 * 36e5;
const kst = t => new Date(t + KST);  // UTC 함수로 읽으면 한국 시각
const hm = n => `${String(Math.floor(n / 100)).padStart(2, "0")}:${String(n % 100).padStart(2, "0")}`;
function fmt(iso) {
  if (!iso) return "";
  const d = kst(Date.parse(iso));
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WEEK[d.getUTCDay()]}) ${hm(d.getUTCHours() * 100 + d.getUTCMinutes())}`;
}
const period = e => `${fmt(e.start)} ~ ${e.end ? fmt(e.end) : "계속"}`;
const gameVer = v => { const [a, b, c] = v.split(".").map(Number); return a * 10000 + b * 100 + c; };

// 기간이 1년 넘게 열려 있으면 상시 (요일 스테이지·로그인 보너스 등)
const regular = e => !e.end || Date.parse(e.end) - Date.parse(e.start || "2000-01-01") >= 365 * DAY;

// 요일·날짜·시간 조건을 글로
function ruleText(r) {
  const out = [];
  if (r.date) {
    const [sd, st, ed, et] = r.date;
    out.push(`${Math.floor(sd / 100)}/${sd % 100} ${hm(st)} ~ ${Math.floor(ed / 100)}/${ed % 100} ${hm(et)}`);
  }
  if (r.days) out.push(`매월 ${r.days.join("·")}일`);
  if (r.week) out.push(`매주 ${WEEK.filter((_, i) => r.week & (1 << i)).join("·")}`);
  if (r.times && !(r.times.length === 1 && r.times[0][0] === 0 && r.times[0][1] >= 2400))
    out.push(r.times.map(([a, b]) => `${hm(a)}~${hm(b)}`).join(", "));
  return out.join(" ");
}

// 지금 열려 있는지 (기간 + 조건 중 하나라도 맞으면)
function openNow(e, now) {
  if (e.start && now < Date.parse(e.start)) return false;
  if (e.end && now >= Date.parse(e.end)) return false;
  if (!e.rules) return true;
  const d = kst(now), md = (d.getUTCMonth() + 1) * 100 + d.getUTCDate(), t = d.getUTCHours() * 100 + d.getUTCMinutes();
  return e.rules.some(r => {
    if (r.date) {
      const [sd, st, ed, et] = r.date, a = sd * 1e4 + st, b = ed * 1e4 + et, x = md * 1e4 + t;
      if (a <= b ? x < a || x >= b : x < a && x >= b) return false;
    }
    if (r.days && !r.days.includes(d.getUTCDate())) return false;
    if (r.week && !(r.week & (1 << d.getUTCDay()))) return false;
    if (r.times && !r.times.some(([a, b]) => a <= t && t < b)) return false;
    return true;
  });
}

const ui = { view: "today", show: "now", regular: false, onlyNew: false, month: null, day: null };
const KINDS = { gatya: "뽑기", stage: "스테이지", item: "이벤트·보상" };
const dayOf = t => Math.floor((t + KST) / DAY);  // 한국 날짜 번호 (1970-01-01 = 0)
const ymd = d => { const x = new Date(d * DAY); return [x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate(), x.getUTCDay()]; };
const startDay = r => dayOf(Date.parse(r.start || "2000-01-01T00:00+09:00"));
const endDay = r => r.end ? dayOf(Date.parse(r.end) - 1) : Infinity;  // 끝나는 시각이 든 날까지 (0시에 끝나면 전날)
const hasDex = () => !!store.data?.cats && Object.keys(store.data.cats).length > 0;
// 이 일정에서 얻을 수 있는데 내 도감에 없는 캐릭
const newCats = r => hasDex() ? (r.cats || []).filter(c => !store.owned(c.id)) : [];

export function renderSchedule(root) {
  root.innerHTML = `
    <p class="crumb"><a href="#/">냥코위키</a><i>/</i><span>일정</span></p>
    <div class="page-head"><div><h1>일정</h1><p>게임 서버의 이벤트 데이터로 만든 스테이지·뽑기·이벤트 일정이에요. 시각은 한국 시간.</p></div></div>
    <div class="filters"><div class="row" id="scTabs"></div></div>
    <p class="meta" id="scMeta"></p>
    <div id="scBody"><div class="empty">불러오는 중…</div></div>`;
  let draw = null;
  Promise.all([loadSchedule(), loadIndex(), loadSets().catch(() => ({ sets: [], pick: {} })), loadDrops().catch(() => ({}))]).then(([data, idx, sets, drops]) => {
    const maps = new Map(idx.categories.flatMap(c => c.maps.map(([mid, name]) => [mid, { name, cat: c.name }])));
    // 맵 → 그 맵에서 드롭되는 캐릭 (cat_drops.json 은 캐릭 → [맵, 스테이지, 확률, …])
    const dropsByMap = new Map();
    for (const [cid, list] of Object.entries(drops)) for (const [mid] of list) {
      const c = BYID.get(+cid);
      if (!c) continue;
      if (!dropsByMap.has(mid)) dropsByMap.set(mid, new Set());
      dropsByMap.get(mid).add(c);
    }
    const fetched = Date.parse(data.fetchedAt);
    const mins = Math.max(0, Math.round((Date.now() - fetched) / 6e4));
    root.querySelector("#scMeta").textContent = `${mins < 60 ? `${mins}분` : `${Math.round(mins / 60)}시간`} 전 갱신 · 서버 게임 버전 ${data.gameVersion}`;
    const now = Date.now(), today = dayOf(now);
    const rows = [...gatyaRows(data.gatya, sets), ...stageRows(data.sale, maps, dropsByMap, now), ...itemRows(data.item)];
    if (ui.month == null) { const [y, m] = ymd(today); ui.month = y * 12 + m; }
    if (ui.day == null) ui.day = today;
    draw = () => {
      const dex = hasDex();
      if (!dex) ui.onlyNew = false;
      const tabs = [["today", "오늘"], ["cal", "달력"], ["list", "목록"]].map(([k, l]) => `<button class="chip" data-view="${k}" aria-pressed="${ui.view === k}">${l}</button>`).join("");
      const sub = ui.view !== "list" ? "" : `<span class="sc-sep"></span>` + [["now", "진행 중"], ["soon", "예정"], ["all", "전부"]].map(([k, l]) =>
        `<button class="chip" data-show="${k}" aria-pressed="${ui.show === k}">${l}</button>`).join("")
        + `<button class="chip" data-reg aria-pressed="${ui.regular}">상시 이벤트 포함</button>`;
      const mine = dex ? `<span class="sc-sep"></span><button class="chip sc-newchip" data-new aria-pressed="${ui.onlyNew}">★ 없는 캐릭을 얻을 수 있는 것만</button>` : "";
      root.querySelector("#scTabs").innerHTML = tabs + sub + mine;
      const shown = ui.onlyNew ? rows.filter(r => newCats(r).length) : rows;
      const body = root.querySelector("#scBody");
      const hint = dex ? "" : `<p class="sc-hint">내 도감에 세이브를 불러오면, 내가 아직 없는 캐릭을 얻을 수 있는 뽑기·스테이지에 ★ 표시가 붙어요. <a href="#/dex">내 도감</a></p>`;
      if (ui.view === "today") body.innerHTML = hint + todayView(shown, rows, now);
      else if (ui.view === "cal") {
        // 달력은 기간 한정 일정만 (상시 이벤트는 매일 칸을 채워 버린다)
        const limited = shown.filter(r => !regular(r));
        const onDay = limited.filter(r => startDay(r) <= ui.day && ui.day <= endDay(r));
        const [, m, d, w] = ymd(ui.day);
        body.innerHTML = hint + calendar(limited, today)
          + `<h3 class="sc-dayhead">${m + 1}월 ${d}일 (${WEEK[w]}) 일정 <small>${onDay.length}개</small></h3>`
          + (panels(onDay) || `<div class="empty">이 날은 기간 한정 일정이 없어요.</div>`);
      } else {
        const pick = r => (ui.regular || !regular(r)) && (ui.show === "all"
          || (ui.show === "now" ? !r.start || Date.parse(r.start) <= now : Date.parse(r.start) > now));
        body.innerHTML = hint + (panels(shown.filter(pick)) || `<div class="empty">해당하는 일정이 없어요.</div>`);
      }
      root.querySelectorAll("[data-view]").forEach(b => b.onclick = () => { ui.view = b.dataset.view; draw(); });
      root.querySelectorAll("[data-show]").forEach(b => b.onclick = () => { ui.show = b.dataset.show; draw(); });
      root.querySelector("[data-reg]")?.addEventListener("click", () => { ui.regular = !ui.regular; draw(); });
      root.querySelector("[data-new]")?.addEventListener("click", () => { ui.onlyNew = !ui.onlyNew; draw(); });
      root.querySelectorAll("[data-mon]").forEach(b => b.onclick = () => {
        if (b.dataset.mon === "0") { const [y, m] = ymd(today); ui.month = y * 12 + m; ui.day = today; } else ui.month += +b.dataset.mon;
        draw();
      });
      root.querySelectorAll("[data-day]").forEach(b => b.onclick = () => {
        ui.day = +b.dataset.day;
        draw();
        root.querySelector(".sc-dayhead")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    };
    draw();
  }).catch(() => { root.querySelector("#scBody").innerHTML = `<div class="empty">일정 데이터를 불러오지 못했어요. 잠시 뒤 새로고침해 주세요.</div>`; });
  return () => draw?.();  // 내 도감이 바뀌면 ★ 표시를 다시 계산
}

// ---- 카드 (목록·달력에서 고른 날짜·오늘) ----
function card(r, top = "") {
  const nc = newCats(r);
  const badge = nc.length ? `<span class="sc-newbadge">★ 없는 캐릭 ${nc.length}</span>` : "";
  const newRow = nc.length && r.kind === "stage"
    ? `<div class="sc-cats sc-newcats"><small>드롭:</small>${nc.slice(0, 10).map(c => `<a href="#/cat/${c.id}" title="${esc(c.forms[0].name)}">${icon(c, 0)}</a>`).join("")}${nc.length > 10 ? `<span>외 ${nc.length - 10}</span>` : ""}</div>` : "";
  return `<div class="sc-item${r.open ? " open" : ""}${nc.length ? " has-new" : ""}">
    <div class="sc-when">${top}<span>${period(r)}</span>${r.open ? `<span class="sc-open">지금 열림</span>` : ""}${badge}</div>
    <div class="sc-main">${r.main()}${newRow}</div></div>`;
}

// 종류별 패널
function panels(rows, top) {
  return Object.entries(KINDS).map(([k, title]) => {
    const list = rows.filter(r => r.kind === k)
      .sort((a, b) => (b.open || 0) - (a.open || 0) || ((a.start || "") < (b.start || "") ? -1 : 1));
    return list.length ? `<div class="panel"><h2>${title} <span class="ctl">${list.length}개</span></h2><div class="sc-list">${list.map(r => card(r, top?.(r))).join("")}</div></div>` : "";
  }).join("");
}

// ---- 오늘: 남은 시간 / 오늘 시간표 / 곧 시작 ----
function left(ms) {
  const m = Math.max(0, Math.floor(ms / 6e4)), d = Math.floor(m / 1440), h = Math.floor(m % 1440 / 60);
  return d ? `${d}일 ${h}시간` : h ? `${h}시간 ${m % 60}분` : `${m % 60}분`;
}
// 그 날(한국 날짜 번호)에 열리는 시간대 [시작 분, 끝 분]. 조건이 없으면 하루 종일.
function windowsOn(r, day) {
  const t0 = day * DAY - KST;  // 그 날 0시
  if ((r.start && Date.parse(r.start) >= t0 + DAY) || (r.end && Date.parse(r.end) <= t0)) return [];
  const clip = ([a, b]) => {  // 이벤트 시작·끝 시각으로 자른다
    const s = Math.max(a, r.start ? (Date.parse(r.start) - t0) / 6e4 : 0), e = Math.min(b, r.end ? (Date.parse(r.end) - t0) / 6e4 : 1440);
    return e > s ? [s, e] : null;
  };
  if (!r.rules) return [[0, 1440]].map(clip).filter(Boolean);
  const [, mo, dd, wd] = ymd(day), md = (mo + 1) * 100 + dd, out = [];
  for (const q of r.rules) {
    if (q.days && !q.days.includes(dd)) continue;
    if (q.week && !(q.week & (1 << wd))) continue;
    if (q.date) {  // 날짜 범위: 그 날에 걸치는지만 본다 (시각 경계는 아래 시간대로 충분)
      const [sd, , ed] = q.date;
      if (sd <= ed ? md < sd || md > ed : md < sd && md > ed) continue;
    }
    for (const [a, b] of q.times || [[0, 2400]]) out.push([Math.floor(a / 100) * 60 + a % 100, Math.floor(b / 100) * 60 + b % 100]);
  }
  return out.map(clip).filter(Boolean);
}
const fullDay = ws => ws.length === 1 && ws[0][0] <= 0 && ws[0][1] >= 1440;
const mm = n => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(Math.round(n % 60)).padStart(2, "0")}`;

function todayView(shown, all, now) {
  const today = dayOf(now), nowMin = (now + KST) % DAY / 6e4;
  // 지금 기간 안에 있는 기간 한정 일정: 끝나는 순서. 시간대가 정해진 건 오늘 다음 시간대를 같이 보여준다
  const live = shown.filter(r => !regular(r) && Date.parse(r.start || 0) <= now && (!r.end || now < Date.parse(r.end)))
    .sort((a, b) => Date.parse(a.end) - Date.parse(b.end));
  const top = r => {
    const ms = Date.parse(r.end) - now;
    const ws = r.rules ? windowsOn(r, today) : [];
    const cur = ws.find(([a, b]) => a <= nowMin && nowMin < b), next = ws.find(([a]) => a > nowMin);
    const slot = !r.rules ? "" : cur && !fullDay(ws) ? `<span class="sc-slot on">지금 ~${mm(cur[1])}</span>`
      : next ? `<span class="sc-slot">오늘 ${mm(next[0])}~</span>` : !cur ? `<span class="sc-slot off">오늘은 끝</span>` : "";
    return `<span class="sc-left${ms < DAY ? " soon" : ""}">${left(ms)} 남음</span>${slot}`;
  };
  // 오늘 시간표: 오늘 시간대가 정해진 스테이지·이벤트 (상시 포함, 하루 종일은 빼고)
  const tt = all.filter(r => r.kind !== "gatya" && r.rules).map(r => ({ r, ws: windowsOn(r, today) }))
    .filter(x => x.ws.length && !fullDay(x.ws) && !(ui.onlyNew && !newCats(x.r).length))
    .sort((a, b) => a.ws[0][0] - b.ws[0][0]);
  const soon = shown.filter(r => !regular(r) && Date.parse(r.start) > now && Date.parse(r.start) - now < 7 * DAY)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const ttRow = ({ r, ws }) => `<div class="sc-tt-row"><a ${r.href ? `href="${r.href}"` : ""} title="${esc(r.label)}">${esc(r.label)}</a><div class="sc-tt-track">${ws.map(([a, b]) =>
    `<b class="${a <= nowMin && nowMin < b ? "on" : b <= nowMin ? "past" : ""}" style="left:${a / 14.4}%;width:${(b - a) / 14.4}%" title="${mm(a)}~${mm(b)}"></b>`).join("")}<u style="left:${nowMin / 14.4}%"></u></div></div>`;
  // 오늘 시간대가 아직 남은 줄이 위, 오늘은 다 끝난 줄은 접어 둔다
  const ttLeft = tt.filter(x => x.ws.some(([, b]) => b > nowMin)), ttDone = tt.filter(x => !ttLeft.includes(x));
  const ttHtml = !tt.length ? "" : `<div class="panel"><h2>오늘 시간표 <span class="ctl">게릴라 경험치처럼 시간이 정해진 스테이지</span></h2>
    <div class="sc-tt"><div class="sc-tt-axis"><span></span><div>${[0, 3, 6, 9, 12, 15, 18, 21].map(h => `<i style="left:${h / 24 * 100}%">${h}</i>`).join("")}</div></div>
    ${ttLeft.map(ttRow).join("") || `<p class="sc-hint">오늘 남은 시간대가 없어요.</p>`}
    ${ttDone.length ? `<details><summary>오늘은 끝난 시간대 ${ttDone.length}개</summary>${ttDone.map(ttRow).join("")}</details>` : ""}
    </div></div>`;
  return `<h3 class="sc-dayhead">지금 열린 일정 <small>${live.length}개 · 끝나는 순서</small></h3>`
    + (live.length ? `<div class="sc-list">${live.map(r => card(r, top(r))).join("")}</div>` : `<div class="empty">지금 열린 기간 한정 일정이 없어요.</div>`)
    + ttHtml
    + (soon.length ? `<h3 class="sc-dayhead">곧 시작 <small>7일 안</small></h3><div class="sc-list">${soon.map(r =>
      card(r, `<span class="sc-left">${left(Date.parse(r.start) - now)} 뒤 시작</span>`)).join("")}</div>` : "");
}

// ---- 달력: 한 주에 한 줄, 기간은 날짜 칸을 가로지르는 막대 ----
const LANES = 14;  // 한 주에 보여줄 막대 줄 수. 넘치면 날짜 칸에 "+N" (날짜를 누르면 전부 보임)
const KIND_ORDER = { gatya: 0, stage: 1, item: 2 };
// 종류·기간이 같은 일정은 막대 하나로 (게릴라 경험치 5종, 같은 날 시작하는 콜라보 스테이지 등)
function groupBars(rows) {
  const by = new Map();
  for (const r of rows) {
    const k = `${r.kind}|${startDay(r)}|${endDay(r)}`;
    const g = by.get(k);
    if (g) { g.cnt += r.cnt; g.isNew ||= newCats(r).length > 0; } else by.set(k, { ...r, isNew: newCats(r).length > 0 });
  }
  return [...by.values()];
}
function calendar(rows, today) {
  rows = groupBars(rows);
  const y = Math.floor(ui.month / 12), m = ui.month % 12;
  const first = Date.UTC(y, m, 1) / DAY, last = Date.UTC(y, m + 1, 1) / DAY - 1;
  const from = first - ymd(first)[3], to = last + 6 - ymd(last)[3];
  let weeks = "";
  for (let ws = from; ws <= to; ws += 7) {
    const we = ws + 6;
    const inWeek = rows.filter(r => startDay(r) <= we && endDay(r) >= ws)
      .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || Math.max(startDay(a), ws) - Math.max(startDay(b), ws) || endDay(b) - endDay(a));
    const laneEnd = [], hidden = Array(7).fill(0), bars = [];
    for (const r of inWeek) {
      const s = Math.max(startDay(r), ws) - ws, e = Math.min(endDay(r), we) - ws;
      let li = laneEnd.findIndex(end => end < s);
      if (li < 0) { li = laneEnd.length; laneEnd.push(-1); }
      laneEnd[li] = e;
      if (li >= LANES) { for (let i = s; i <= e; i++) hidden[i]++; continue; }
      const cls = `sc-bar k-${r.kind}${startDay(r) < ws ? " cont-l" : ""}${endDay(r) > we ? " cont-r" : ""}`;
      // 막대를 누르면 그 막대가 걸친 날 중 지금 고른 날(없으면 첫날)의 일정을 보여준다
      const pickDay = ui.day >= ws + s && ui.day <= ws + e ? ui.day : ws + s;
      const text = (r.isNew ? "★ " : "") + barLabel(r);
      bars.push(`<button class="${cls}" style="grid-column:${s + 1}/${e + 2};grid-row:${li + 2}" data-day="${pickDay}" title="${esc(text)} · ${esc(period(r))}">${esc(text)}</button>`);
    }
    const nl = Math.min(laneEnd.length, LANES);
    const cells = Array.from({ length: 7 }, (_, i) => {
      const d = ws + i, [, dm, dd, dw] = ymd(d);
      const cls = `sc-day${dm !== m ? " out" : ""}${d === today ? " today" : ""}${d === ui.day ? " sel" : ""}${dw === 0 ? " sun" : dw === 6 ? " sat" : ""}`;
      return `<button class="${cls}" data-day="${d}" style="grid-column:${i + 1};grid-row:1/${nl + 3}" aria-label="${dm + 1}월 ${dd}일"><span>${dd}</span>${hidden[i] ? `<small>+${hidden[i]}</small>` : ""}</button>`;
    }).join("");
    weeks += `<div class="sc-week" style="grid-template-rows:28px repeat(${nl},21px) 20px">${cells}${bars.join("")}</div>`;
  }
  return `<div class="panel sc-cal">
    <div class="sc-calhead"><button class="btn" data-mon="-1" aria-label="이전 달">‹</button><b>${y}년 ${m + 1}월</b><button class="btn" data-mon="1" aria-label="다음 달">›</button><button class="btn" data-mon="0">오늘</button>
      <span class="sc-legend">${Object.entries(KINDS).map(([k, t]) => `<span><i class="k-${k}"></i>${t}</span>`).join("")}</span></div>
    <div class="sc-wk">${WEEK.map((w, i) => `<span class="${i === 0 ? "sun" : i === 6 ? "sat" : ""}">${w}</span>`).join("")}</div>
    ${weeks}</div>`;
}

// ---- 뽑기 ----
const GATYA_KIND = { rare: "레어 뽑기", normal: "노말 뽑기", collab: "이벤트 뽑기" };
// 배너 문구 앞의 "★확률, 상세 내용은 배너를 클릭!★" 같은 안내는 뺀다
const cleanMsg = m => m.replace(/^★확률[^★]*★/, "").replace(/★/g, " ★ ").replace(/\s+/g, " ").trim();
const shortMsg = m => cleanMsg(m).replace(/[☆★【】]|기간 한정/g, " ").replace(/\s+/g, " ").trim().slice(0, 24);

// 각 일정 = { kind, start, end, rules, label·cnt(달력 막대: "label 외 cnt-1"), cats(얻을 수 있는 캐릭), main()(카드 본문), open?, href? }
const barLabel = r => r.cnt > 1 ? `${r.label} 외 ${r.cnt - 1}` : r.label;
function gatyaRows(list, sets) {
  // 같은 세트가 여러 줄(배너 칸)에 나오면 하나로 합치고 기간은 가장 이른 시작 ~ 가장 늦은 끝
  const by = new Map();
  for (const e of list) for (const s of e.sets) {
    if (s.id < 0 || (!s.msg && e.kind !== "rare")) continue;
    const key = `${e.kind}:${s.id}`, cur = by.get(key);
    if (!cur) by.set(key, { ...e, set: s });
    else {
      if (e.start < cur.start) cur.start = e.start;
      if (!e.end || (cur.end && e.end > cur.end)) cur.end = e.end;
    }
  }
  const builtFor = gameVer(GD.builtFor || GD.version);
  return [...by.values()].map(e => {
    // 레어 뽑기 세트의 캐릭: 우리 데이터보다 새 버전 이벤트면 세트 내용이 아직 비어 있을 수 있어서 안 보여준다
    // 대표 캐릭(배너 옵션의 CharaID)을 맨 앞에. 콜라보 캐릭은 세트 목록에 없고 대표 캐릭으로만 나오기도 한다
    const ok = e.kind === "rare" && e.minVer <= builtFor;
    const feat = ok ? BYID.get(sets.pick[e.set.id]) : null;
    const cats = (ok ? sets.sets[e.set.id] || [] : []).map(id => BYID.get(id)).filter(c => c && c !== feat);
    const label = feat ? `${feat.forms[0].name} 뽑기` : e.set.msg ? shortMsg(e.set.msg) : `${GATYA_KIND[e.kind] || "뽑기"} ${e.set.id}`;
    const main = () => {
      // 보여주는 아이콘: 대표 캐릭 + 울트라슈퍼레어 이상 (없으면 전부). 내 도감에 있는 캐릭은 흐리게
      const top = cats.filter(c => c.rarity >= 4);
      const pool = [...(feat ? [feat] : []), ...(top.length ? top : cats)];
      const show = pool.slice(0, 14), more = pool.length - show.length, dex = hasDex();
      return `<b>${GATYA_KIND[e.kind] || "뽑기"}</b> <small>세트 ${e.set.id}</small>
        ${e.set.msg ? `<p>${esc(cleanMsg(e.set.msg))}</p>` : ""}
        ${show.length ? `<div class="sc-cats">${show.map(c => {
          const cls = [c === feat && "feat", dex && store.owned(c.id) && "have"].filter(Boolean).join(" ");
          return `<a href="#/cat/${c.id}" title="${esc(c.forms[0].name)}${dex && !store.owned(c.id) ? " (없음)" : ""}"${cls ? ` class="${cls}"` : ""}>${icon(c, 0)}</a>`;
        }).join("")}${more > 0 ? `<span>외 ${more}</span>` : ""}</div>` : ""}
        ${e.kind === "rare" && e.minVer > builtFor ? `<small class="sc-note">게임 v${Math.floor(e.minVer / 10000)}.${Math.floor(e.minVer / 100) % 100} 새 뽑기라 캐릭 목록은 사이트 데이터 업데이트 뒤에 보여요.</small>` : ""}`;
    };
    return { kind: "gatya", start: e.start, end: e.end, label, cnt: 1, cats: feat ? [feat, ...cats] : cats, main };
  });
}

// ---- 스테이지 ----
function stageRows(list, maps, dropsByMap, now) {
  return list.map(e => {
    const known = e.maps.filter(m => maps.has(m));
    if (!known.length) return null;
    const other = e.maps.length - known.length;
    const cats = [...new Set(known.flatMap(m => [...(dropsByMap.get(m) || [])]))];
    const main = () => `
        <div class="sc-maps">${known.map(m => `<a href="#/stage/${m}">${esc(maps.get(m).name)}<small>${esc(maps.get(m).cat)}</small></a>`).join("")}${other ? `<span class="sc-more">그 외 ${other}개</span>` : ""}</div>
        ${e.rules ? `<p class="sc-rule">${e.rules.map(ruleText).filter(Boolean).map(esc).join(" / ")}</p>` : ""}`;
    return { kind: "stage", start: e.start, end: e.end, rules: e.rules, label: maps.get(known[0]).name, cnt: known.length,
             cats, open: openNow(e, now), href: `#/stage/${known[0]}`, main };
  }).filter(Boolean);
}

// ---- 이벤트·로그인 보상 (제목 있는 것만) ----
function itemRows(list) {
  const seen = new Set();
  return list.filter(e => e.title && !seen.has(e.title + e.start) && seen.add(e.title + e.start)).map(e => ({
    kind: "item", start: e.start, end: e.end, rules: e.rules, label: e.title.replace(/[☆★]/g, "").trim(), cnt: 1,
    main: () => `<b>${esc(e.title)}</b>${e.rules ? `<p class="sc-rule">${e.rules.map(ruleText).filter(Boolean).map(esc).join(" / ")}</p>` : ""}` }));
}
