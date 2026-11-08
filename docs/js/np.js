// NP효율 — NP를 얻는 방법(뽑기·강습·지도·티켓 스테이지)마다 통솔력·리더쉽·통조림 하나당 NP를 비교한다.
// 게임 데이터 값은 tools/build_np.py 가 만든 data/np.json, 뽑기 확률은 일정 데이터(서버 이벤트)에서.
import { esc, BYID } from "./common.js";
import { loadSchedule, openNow } from "./schedule.js";

let npPromise;
const loadNp = () => npPromise ??= fetch("data/np.json").then(r => r.json());

// 환산 기준 (이 브라우저에 저장)
const KEY = "nyanko-wiki.np";
const DEF = { maxEnergy: 1200, leaderCans: 30, rareCans: 150, catPlus: true, drink: false, lv: 19, group: "all", eventChar: 10, perEnergy: 100, perCans: 100, xpMult: 4.7, xpCombo: false,
  // NP로 칠 것 (켜고 끌 수 있게)
  npRare: true, npBlue: true, npOrb: true, npXp: false, xpAdOff: {}, xpDocOff: {}, radarOn: {}, npRadar: true, tNp: {}, exMap: {}, tab: "rank" };
// 레어 뽑기 종류별 확률 % [레어, 슈레, 울슈레, 레전드]. 축제는 열려 있을 때만 서버 데이터에 나와서 커뮤니티 정리 값을 쓴다
const RARE_KINDS = [
  ["reg", "정규 레어 뽑기", [69.7, 25, 5, 0.3]],
  ["nolg", "레전드 없는 뽑기", [70, 25, 5, 0]],
  ["uberfest", "울하고축", [64.7, 25, 10, 0.3]],
  ["fest", "울고축·하고축", [64.7, 26, 9, 0.3]],
  ["king", "국왕 축제", [67.7, 25, 7, 0.3]],
  ["queen", "여왕 축제", [69.4, 25, 5, 0.6]],
  ["double", "울슈레·레전드 확률 2배", [64.4, 25, 10, 0.6]],
];
const kindRates = r => [[0, 0], ...r.map(p => [p * 100, 0])];
const RARE_BEST = RARE_KINDS.find(([k]) => k === "double");  // 레어 티켓 가치 기준
// 냥코 뽑기(냥코 티켓): 기본 캐릭 아니면 파란구슬. 파란구슬 5개 = 레어 티켓 1장.
// 뽑기 칸 구성(기본 캐릭 9 + 파란구슬 9, 우주편 3장 뒤 "냥코 뽑기+"는 고양이 초인이 더해져 10 + 9)과
// 냥코 뽑기+ 기본 캐릭 2NP는 게임 데이터에 없어서 커뮤니티 정리 값을 쓴다.
const CAT_GATYA = { false: { orb: 9 / 18, cat: 1 }, true: { orb: 9 / 19, cat: 2 } };
const ORBS_PER_RARE = 5;
const catTicketNp = rareNp => { const g = CAT_GATYA[opt.catPlus]; return (opt.npBlue ? g.orb * rareNp / ORBS_PER_RARE : 0) + (1 - g.orb) * g.cat; };
// XP → NP (사당 환산, XP 100만 = 0.45NP = 500만당 약 2.25NP). 꺼져 있으면 0
const XP_NP = 0.45;
const xpNp = xp => opt.npXp ? (xp || 0) / 1e6 * XP_NP : 0;
let XP_ITEMS = {};
// EX 출현율: 맵마다 직접 정할 수 있음 (비우면 게임 데이터 값). 팩맨은 나무위키·커뮤니티가 "각 10%"라고 해서 기본 10%
const EX_DEFAULT = { 2271: 10 };
const exPctOf = s => opt.exMap[s.map] ?? EX_DEFAULT[s.map] ?? s.ex.p;
const exProb = s => exPctOf(s) / 100;
// 한 번 클리어할 때 티켓 기대값 (EX 포함)
const stageTickets = (s, tid) => (s.t[tid] || 0) + (s.ex?.t[tid] ? exProb(s) * s.ex.t[tid] : 0);  // 뽑기에서 나오는 XP 아이템 → XP 양 (np.json)
const opt = (() => { try { return { ...DEF, ...JSON.parse(localStorage.getItem(KEY)) }; } catch { return { ...DEF }; } })();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(opt)); } catch {} };

const RATE_RARITY = [0, 2, 3, 4, 5];  // 뽑기 확률 순서 [노멀, 레어, 슈레, 울슈레, 레전드] → 레어도 (np.json dupe 순서)
const TIERS = ["기원", "정점", "비경"];
const GROUPS = { gatya: "뽑기", beh: "강습", map: "지도·보물섬", ticket: "티켓 스테이지", lucky: "럭키 티켓", event: "이벤트 티켓", xp: "XP" };
const LUCKY = new Set(["155", "156"]);  // 럭키 티켓 · 럭키 티켓G

const pullNp = (rates, dupe) => rates.reduce((s, [p], i) => s + p / 1e4 * dupe[RATE_RARITY[i]], 0);
const n2 = x => x.toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = x => `${+x.toFixed(2)}%`;
const bannerName = m => m.replace(/^★확률[^★]*★/, "").replace(/[☆★【】]|기간 한정/g, " ").replace(/\s+/g, " ").trim().slice(0, 34) || "레어 뽑기";

export function renderNp(root) {
  root.innerHTML = `
    <p class="crumb"><a href="#/">냥코위키</a><i>/</i><a href="#/items">아이템</a><i>/</i><span>NP효율</span></p>
    <div class="page-head"><div><h1>NP효율</h1><p>NP를 얻는 방법마다 통솔력·리더쉽·통조림 하나에 NP를 얼마나 얻는지 기대값으로 비교해요.</p></div></div>
    <div class="row np-tabs" id="npTabs"></div>
    <div class="filters" id="npOpt"></div>
    <div id="npBody"><div class="empty">불러오는 중…</div></div>`;
  Promise.all([loadNp(), loadSchedule().catch(() => null)]).then(([d, sc]) => {
    const now = Date.now();
    const banners = gatyaBanners(sc, d.dupe, now);
    XP_ITEMS = d.xpItems || {};
    const draw = () => {
      // 레어 티켓은 가장 좋은 뽑기(울슈레·레전드 확률 2배)에 쓴다고 본다.
      // 어디에 쓰든 다른 방법과 비교한 상대 가치는 같아서, 고르는 칸 없이 하나로 고정 (사용자 결정)
      const rareRaw = pullNp(kindRates(RARE_BEST[2]), d.dupe);
      const rareNp = opt.npRare ? rareRaw : 0;  // 레어 티켓을 뽑지 않고 아껴 두면 NP 0
      const tg = ticketGacha(d, sc, now, rareNp);
      const rows = [...gatyaRows(banners, rareNp, d.dupe), ...behRows(d), ...mapRows(d), ...ticketRows(d, sc, now, rareNp),
        ...eventRows(d, sc, now, tg), ...xpRows(d)];
      paintTabs(root, draw);
      const optBox = root.querySelector("#npOpt");
      optBox.style.display = opt.tab === "basis" ? "none" : "";  // .filters 의 display 가 hidden 속성을 덮어써서
      if (opt.tab === "basis") root.querySelector("#npBody").innerHTML = basisHtml(d, tg, rareRaw);
      else { paintOpt(root, d, rareRaw, draw); paintBody(root, rows, d, tg, draw); }
    };
    draw();
  }).catch(() => { root.querySelector("#npBody").innerHTML = `<div class="empty">데이터를 불러오지 못했어요. 새로고침해 주세요.</div>`; });
  return null;
}

// ---- 환산 기준 ----
function paintOpt(root, d, rareNp, draw) {
  const box = root.querySelector("#npOpt");
  const num = (k, label, step = 1) => `<label class="np-in"><span>${label}</span><input type="number" min="1" step="${step}" data-k="${k}" value="${opt[k]}"></label>`;
  box.innerHTML = `
    <div class="row np-opts">
      ${num("maxEnergy", "최대 통솔력")}
      ${num("leaderCans", "리더쉽 1개 = 통조림")}
      ${num("rareCans", "레어 티켓 1장 = 통조림")}
      <label class="np-in"><span>냥코 뽑기</span><select data-k="catPlus"><option value="0"${opt.catPlus ? "" : " selected"}>기본</option><option value="1"${opt.catPlus ? " selected" : ""}>냥코 뽑기+ (우주편 3장 뒤)</option></select></label>
      <label class="np-in" title="확률이 서버 데이터에 없는(지금 안 열린) 이벤트 뽑기에서 한정 캐릭터가 나올 확률"><span>지난 이벤트 뽑기 한정 캐릭 %</span><input type="number" min="0" max="100" step="0.1" data-k="eventChar" value="${opt.eventChar}"></label>
      ${opt.npXp ? `<span title="(공부력 레벨 + 19) ÷ 20 + 보물(현자의 돌 최대 150% + 뉴트리노 최대 75%). 공부력 Lv30·보물 다 모으면 최대 4.7배 (나무위키 자원 문서, 초극악 게릴라 실측 1,381,800과 일치)">${num("xpMult", "클리어 XP 보너스 배율", 0.01)}</span>
      <button class="chip" data-t="xpCombo" aria-pressed="${opt.xpCombo}" title="냥콤보 굳잡: 클리어 XP +10% (고양이 박사와 같이 쓰면 1.5 × 1.1 = 1.65배)">굳잡 냥콤보</button>` : ""}
    </div>
    <div class="row np-opts">
      <span class="np-lab">NP로 칠 것</span>
      ${[["npRare", "레어 티켓 뽑기", "레어 티켓을 뽑아서 나온 캐릭을 전부 NP로. 새 캐릭이거나 +레벨이 덜 찼으면 실제로는 NP가 안 되니, 그럴 땐 끄세요 (레어 티켓 0NP)"],
        ["npBlue", "파란구슬 → 레어 티켓", "냥코 뽑기 파란구슬 5개를 레어 티켓으로 바꿔 뽑기. 그 파란구슬 능력이 +10까지 다 올라가 있어야 바꿀 수 있어요 (레어 티켓 뽑기가 켜져 있어야 의미 있음)"],
        ["npOrb", "본능옥 분해", "강습·지도에서 나온 본능옥을 전부 NP로 (끄면 강습·지도는 0)"],
        ["npRadar", "트레저 레이더", "럭키 뽑기에서 나오는 트레저 레이더 1개 = 1.6NP (역습의 대갈이군에 쓰면 냥코 티켓 0.7장 이득)"],
        ["npXp", "XP", "스테이지 클리어 XP·XP 드롭·뽑기 XP를 사당 환산 비율로 NP에 더하기"]].map(([k, l, t]) =>
        `<button class="chip" data-t="${k}" aria-pressed="${opt[k]}" title="${t}">${l}</button>`).join("")}
    </div>
    <div class="row">
      ${[["all", "전부"], ...Object.entries(GROUPS).filter(([k]) => k !== "xp" || opt.npXp)].map(([k, l]) => `<button class="chip" data-g="${k}" aria-pressed="${opt.group === k}">${l}</button>`).join("")}
    </div>
    <ul class="np-note np-setv">
      <li>리더쉽 1개 = 통솔력 최대치(${opt.maxEnergy}) = 통조림 ${opt.leaderCans}</li>
      <li>레어 티켓 1장 = ${n2(rareNp)}NP${opt.npRare ? "" : " (지금은 NP로 안 침)"} — ${RARE_BEST[1]}(${RARE_BEST[2].join("/")}) 기준. 어디에 쓰든 다른 방법과의 상대 가치는 같아서 하나로 고정</li>
      <li>냥코 티켓 1장 = ${n2(catTicketNp(opt.npRare ? rareNp : 0))}NP — 파란구슬 ${pct(CAT_GATYA[opt.catPlus].orb * 100)} (${ORBS_PER_RARE}개 = 레어 티켓 1장) + 기본 캐릭 중복 ${CAT_GATYA[opt.catPlus].cat}NP</li>
      <li>트레저 레이더 1개 = ${RADAR_NP}NP — 역습의 대갈이군(2장 70% / 3장 30%)에 써서 3장 확정 = 냥코 티켓 0.7장</li>
      <li>XP 100만 = ${XP_NP}NP — 사당 환산 (500만당 약 2.25NP)</li>
      <li>XP 스테이지 클리어 XP = 기본 × 보너스 ${opt.xpMult}배 (공부력·현자의 돌·뉴트리노, 다 채우면 4.7배) × 광고 2배 × 고양이 박사 1.5배 × 굳잡 냥콤보 1.1배, 소수점 버림. 드롭 XP엔 아무것도 안 붙음</li>
      <li>레어 뽑기 종류별 기준 확률: ${RARE_KINDS.map(([, n, r]) => `${n} ${r.join("/")}`).join(" · ")}</li>
    </ul>`;
  box.querySelectorAll("[data-k]").forEach(el => el.onchange = () => {
    const k = el.dataset.k, v = +el.value;
    if (k === "catPlus") opt.catPlus = v === 1;
    else if (v > 0 || (["lv", "eventChar"].includes(k) && v >= 0)) opt[k] = v;
    save();
    draw();
  });
  box.querySelectorAll("[data-g]").forEach(b => b.onclick = () => { opt.group = b.dataset.g; save(); draw(); });
  box.querySelectorAll("[data-t]").forEach(b => b.onclick = () => {
    const k = b.dataset.t;
    opt[k] = !opt[k];
    if (k === "npXp" && !opt.npXp && opt.group === "xp") opt.group = "all";
    save(); draw();
  });
}

// ---- 표 ----
// 행 = { group, name, sub, href, np(1회), energy(통솔력), cans(통조림), open }
const unfolded = new Set();  // 펼친 맵 (fold 키)
function paintBody(root, rows, d, tg, draw) {
  const cpe = opt.leaderCans / opt.maxEnergy;  // 통솔력 1 = 통조림
  const calc = r => {
    const cans = (r.energy || 0) * cpe + (r.cans || 0), energy = (r.energy || 0) + (r.cans || 0) / cpe;
    if (r.bet) return { ...r, c100: Infinity, e100: Infinity };
    return { ...r, c100: r.np / cans * opt.perCans, e100: r.np / energy * opt.perEnergy };
  };
  const sorted = rows.filter(r => (r.np > 0 || /data-rd="[^"]+" aria-pressed="true"/.test(r.extra || "")) && (opt.group === "all" || r.group === opt.group)).map(calc).sort((a, b) => (b.c100 - a.c100) || (b.np - a.np));
  // 같은 맵(fold 키)의 스테이지는 가장 좋은 것 하나만 보이고 나머지는 접어 둔다
  const heads = new Map();
  for (const r of sorted) {
    const h = r.fold && heads.get(r.fold);
    if (h) h.more.push(r); else heads.set(r.fold || Symbol(), { ...r, more: [] });
  }
  const list = [...heads.values()];
  const E = `통솔력 ${opt.perEnergy}당`, C = `통조림 ${opt.perCans}당`;
  const unit = k => `<input class="np-unit" type="number" min="1" step="1" data-u="${k}" value="${opt[k]}" title="눌러서 비교 기준을 바꿔요">`;
  const cost = r => r.bet || [r.energy && `통솔력 ${r.energy}`, r.cans && `통조림 ${+r.cans.toFixed(1)}`].filter(Boolean).join(" + ");
  const val = (r, x) => r.bet ? `<small>1회</small> ${n2(r.np)}` : n2(x);
  const tr = (r, sub) => `<tr class="${[r.open && "boss", sub && "np-sub"].filter(Boolean).join(" ")}"${sub ? ` data-p="${esc(r.fold)}"${unfolded.has(r.fold) ? "" : " hidden"}` : ""}>
        <td class="en-name">${sub ? `<small class="np-g">└</small>` : `<small class="np-g">${GROUPS[r.group]}</small>`} ${r.href ? `<a href="${r.href}">${esc(r.name)}</a>` : esc(r.name)}${r.open ? ` <span class="sc-open">지금 열림</span>` : ""}${r.sub ? `<br><small>${esc(r.sub)}</small>` : ""}${r.extra ? ` ${r.extra}` : ""}${!sub && r.more.length ? `<br><button class="np-more" data-f="${esc(r.fold)}" aria-expanded="${unfolded.has(r.fold)}">다른 스테이지 ${r.more.length}개 ${unfolded.has(r.fold) ? "접기 ▴" : "보기 ▾"}</button>` : ""}</td>
        <td data-l="비용">${cost(r)}</td>
        <td data-l="${E}">${val(r, r.e100)}</td><td data-l="${C}"><b>${val(r, r.c100)}</b></td></tr>`;
  root.querySelector("#npBody").innerHTML = `
    <div class="panel"><h2>NP효율 순위 <span class="ctl">${list.length}개 · NP / ${C} 순</span></h2>
      <div class="table-wrap"><table class="en-table np-table"><thead><tr><th>방법</th><th>비용</th><th>NP / 통솔력 ${unit("perEnergy")}당</th><th>NP / 통조림 ${unit("perCans")}당</th></tr></thead><tbody>
      ${list.map(r => tr(r, false) + r.more.map(m => tr(m, true)).join("")).join("")}
      </tbody></table></div></div>
    ${ticketPanel(d, tg)}`;
  root.querySelectorAll(".np-more").forEach(b => b.onclick = () => {
    const k = b.dataset.f, on = !unfolded.has(k);
    on ? unfolded.add(k) : unfolded.delete(k);
    root.querySelectorAll(`tr[data-p="${CSS.escape(k)}"]`).forEach(t => t.hidden = !on);
    b.setAttribute("aria-expanded", on);
    b.textContent = b.textContent.replace(/(보기 ▾|접기 ▴)$/, on ? "접기 ▴" : "보기 ▾");
  });
  root.querySelectorAll("[data-exm]").forEach(el => el.onchange = () => {
    const v = el.value.trim();
    if (v === "" || !(+v >= 0)) delete opt.exMap[el.dataset.exm]; else opt.exMap[el.dataset.exm] = Math.min(100, +v);
    save(); draw();
  });
  root.querySelectorAll("[data-lv]").forEach(el => el.onchange = () => { opt.lv = +el.value; save(); draw(); });
  root.querySelectorAll("[data-drk]").forEach(b => b.onclick = () => { opt.drink = !opt.drink; save(); draw(); });
  root.querySelectorAll("[data-rd]").forEach(b => b.onclick = () => {
    const k = b.dataset.rd;
    if (opt.radarOn[k]) delete opt.radarOn[k]; else opt.radarOn[k] = true;
    save(); draw();
  });
  root.querySelectorAll("[data-doc]").forEach(b => b.onclick = () => {
    const m = b.dataset.doc;
    if (opt.xpDocOff[m]) delete opt.xpDocOff[m]; else opt.xpDocOff[m] = true;
    save(); draw();
  });
  root.querySelectorAll("[data-ad]").forEach(b => b.onclick = () => {
    const m = b.dataset.ad;
    if (opt.xpAdOff[m]) delete opt.xpAdOff[m]; else opt.xpAdOff[m] = true;
    save(); draw();
  });
  root.querySelectorAll("[data-u]").forEach(el => el.onchange = () => {
    const v = Math.round(+el.value);
    if (v > 0) { opt[el.dataset.u] = v; save(); }
    draw();
  });
  root.querySelectorAll("[data-tnp]").forEach(el => el.onchange = () => {
    const v = el.value.trim() === "" ? null : +el.value;
    if (v == null || !(v >= 0)) delete opt.tNp[el.dataset.tnp]; else opt.tNp[el.dataset.tnp] = v;
    save(); draw();
  });
}

// ---- 뽑기 ----
function gatyaBanners(sc, dupe, now) {
  if (!sc) return [];
  const seen = new Map();
  for (const e of sc.gatya) {
    if (e.kind !== "rare" || (e.end && Date.parse(e.end) <= now)) continue;
    for (const s of e.sets) {
      if (s.id < 0 || !s.price || !s.msg) continue;  // 배너 문구 없는 세트(상시 기본 세트 등)는 실제로 고를 수 있는 뽑기가 아니다
      const key = `${s.id}|${s.price}|${JSON.stringify(s.rates)}`;
      const open = Date.parse(e.start || 0) <= now;
      const cur = seen.get(key);
      if (cur) { cur.open ||= open; continue; }
      const np = pullNp(s.rates, dupe);
      const sure = s.rates[3]?.[1] === 1;  // 11연 마지막 1회 울트라슈퍼레어 확정
      seen.set(key, { id: s.id, price: s.price, rates: s.rates, np, sure, open, start: e.start, end: e.end,
        name: bannerName(s.msg), np11: sure ? (10 * np + dupe[4]) / 11 : null });
    }
  }
  return [...seen.values()];
}
function gatyaRows(banners, rareNp, dupe) {
  const rows = banners.map(b => {
    const r = b.rates.map(([p]) => p / 100);
    const sub = `레어 ${r[1]}% · 슈레 ${r[2]}% · 울슈레 ${r[3]}%${r[4] ? ` · 레전드 ${r[4]}%` : ""}`
      + (b.sure ? " · 11연 울슈레 확정 (11회 평균)" : "") + (b.open ? "" : ` · ${b.start.slice(5, 10).replace("-", "/")} 시작`);
    // 11연 확정이 있으면 11연 기준이 더 좋다 (통조림 1500 = 11회)
    return { group: "gatya", name: b.name, sub, np: b.sure ? b.np11 : b.np, cans: b.price, open: b.open };
  });
  // 축제 등 뽑기 종류별 기준 확률 (지금 안 열려 있어도 비교할 수 있게)
  for (const [, name, r] of RARE_KINDS)
    rows.push({ group: "gatya", name: `${name} (기준 확률)`, sub: `레어 ${r[0]}% · 슈레 ${r[1]}% · 울슈레 ${r[2]}%${r[3] ? ` · 레전드 ${r[3]}%` : ""}`,
      np: pullNp(kindRates(r), dupe), cans: 150 });
  rows.push({ group: "gatya", name: "레어 티켓 1장", sub: `통조림 ${opt.rareCans}개 가치로 환산`, np: rareNp, cans: opt.rareCans });
  return rows;
}

// ---- 강습 → EX ----
function behRows(d) {
  const by = new Map();
  for (const b of d.behemoth) {
    const s = b.stages.find(x => x.i === opt.lv) || b.stages.at(-1);
    const key = `${s.energy}|${s.ex.join(",")}`;
    if (!by.has(key)) by.set(key, { s, maps: [] });
    by.get(key).maps.push(b);
  }
  return [...by.values()].map(({ s, maps }) => ({
    group: "beh", name: `강습 ${s.i === d.behemoth[0].stages.length - 1 ? "Lv.MAX" : `Lv.${s.i + 1}`}${maps.length > 1 ? ` (${maps.length}종)` : ""}`,
    href: maps.length === 1 ? `#/stage/${maps[0].map}/${s.i}` : null,
    sub: `EX ${TIERS.map((t, k) => s.ex[k] ? `${t} ${pct(s.ex[k])}` : "").filter(Boolean).join(" · ")}${opt.drink ? " · 드링크 A 포함" : ""} — ${maps.map(m => m.name.replace(/ 강습$/, "")).join(", ")}`,
    np: (opt.npOrb ? s.ex.reduce((a, p, k) => a + p / 100 * d.exNp[k], 0) : 0) + xpNp(s.xp), energy: s.energy, cans: opt.drink ? d.drinkA : 0,
    extra: `<select class="np-lv" data-lv title="강습 레벨">${d.behemoth[0].stages.map(x =>
      `<option value="${x.i}"${x.i === s.i ? " selected" : ""}>${x.i === d.behemoth[0].stages.length - 1 ? "Lv.MAX" : `Lv.${x.i + 1}`}</option>`).join("")}</select>
      <button class="np-more" data-drk aria-pressed="${opt.drink}" title="강습은 30분에 한 번. 바로 다시 하려면 고양이 드링크 A(통조림 ${d.drinkA}개)">드링크 A ${opt.drink ? "씀" : "안 씀"}</button>`,
  }));
}

// ---- 지도·보물섬 (본능옥) : 같은 단계·같은 NP는 한 줄로 ----
function mapRows(d) {
  const by = new Map();
  for (const o of d.orbMaps) {
    const island = o.name.includes("보물");
    const title = island ? o.stage : o.name;
    const tier = TIERS.find(t => title.includes(t)) || "";
    const attr = title.split(" 본능")[0];
    const key = `${island}|${tier}|${o.np}|${o.energy}|${o.xp}`;
    if (!by.has(key)) by.set(key, { o, island, tier, attrs: [] });
    by.get(key).attrs.push(attr);
  }
  return [...by.values()].map(({ o, island, tier, attrs }) => {
    const g = o.grades.map((p, k) => p ? `${"DCBAS"[k]} ${p}%` : "").filter(Boolean).join(" · ");
    return { group: "map", name: `${island ? "보물이 잠든 섬" : "지도"} 본능의 ${tier}`, href: `#/stage/${o.map}/${o.i}`,
      sub: `${attrs.join("·")} — ${g}`, np: (opt.npOrb ? o.np : 0) + xpNp(o.xp), energy: o.energy };
  });
}

// ---- 냥코 티켓·레어 티켓 스테이지 ----
// 열릴 때마다 한 번만 깰 수 있는 스테이지 (데이터 플래그로는 구분이 안 돼서 나무위키 기준으로 적는다)
const ONCE_PER_OPEN = { 1078: "열릴 때마다 1번만 (6.7.0부터, 한 달 약 10번)", 1173: "비정기, 열릴 때마다 1번만" };
function ticketRows(d, sc, now, rareNp) {
  const openMaps = new Set((sc?.sale || []).filter(e => openNow(e, now)).flatMap(e => e.maps));
  return d.tickets.map(t => {
    const cNp = catTicketNp(rareNp), base = t.cat * cNp + t.rare * rareNp;
    const can = t.catTop > t.cat + 1e-6 || t.rareTop > t.rare + 1e-6, key = `t${t.map}-${t.i}`, on = can && opt.radarOn[key];
    // 역습의 대갈이군·냥코티켓 찬스는 레이더 가치(1.6NP)를 정한 기준이라 켜든 끄든 같게 0
    const gain = RADAR_REF.has(t.map) ? 0 : (t.catTop - t.cat) * cNp + (t.rareTop - t.rare) * rareNp - RADAR_NP;
    return {
    group: "ticket", name: t.name, href: `#/stage/${t.map}/${t.i}`, open: openMaps.has(t.map), fold: `m${t.map}`,
    sub: `${t.stage} — ${[t.cat && `냥코 티켓 ${+t.cat.toFixed(2)}장`, t.rare && `레어 티켓 ${+t.rare.toFixed(2)}장`].filter(Boolean).join(" + ")}${t.map >= 25000 ? " (지도 1장에 1번)" : ""}${ONCE_PER_OPEN[t.map] ? ` · ${ONCE_PER_OPEN[t.map]}` : ""}`,
    np: base + (on ? gain : 0) + xpNp(t.xp), energy: t.energy,
    extra: can ? radarBtn(key, gain) : "",
  }; });
}

// ---- 이벤트 뽑기·럭키 뽑기 (전용 티켓) ----
// np.json gacha: 티켓 → 세트("normal:62"·"collab:54") → entries [등급 칸, 칸 수, 캐릭(-1), 아이템(-1), 중복 NP]
const GRADE = { normal: ["노멀", "대박", "초 대박", "슈퍼 대박", "레전드"], collab: ["노멀", "대박", "초 대박", "한정 캐릭터", "레전드"] };
const NO_GUARANTEE = new Set([381]);  // 고양이 농가: 10회 확정에서 빠지고 랜덤으로만 나옴
// 지금 일정에 없는 이벤트 뽑기의 한정 캐릭터 칸 확률(%)과 확정 주기(N회마다 한정 캐릭 1개, 0 = 없음).
// 출처: 나무위키 "냥코 대전쟁/캐릭터/EX/이벤트 뽑기" (2026-11-05 확인). 열려 있으면 서버 확률을 쓴다
const EVENT_RATES = {
  231: [10, 10],  // 전설의 저스티스 (냥코레인저)
  270: [15, 0],   // 전설의 반짝임 (다운로드 기념, 30회마다 특별 아이템만)
  235: [10, 10],  // 전설의 복주머니 (설날)
  242: [15, 10],  // 전설의 러브레터 (두근두근 냥코 학교)
  255: [10, 10],  // 전설의 성수 (악마의 준 브라이드)
  260: [10, 10], 196: [10, 10],  // 전설의 벌레 채집망 (여름 방학)
  216: [10, 10], 204: [10, 10],  // 전설의 트랩 (여름 방학 서바이벌)
  259: [8, 50],   // 전설의 돈다발 (여름 방학 파라다이스, 50회마다)
  267: [5, 10],   // 파워 쿠키 (팩맨): 커뮤니티 영상 수치(통솔력 400당 2.71NP, 1스테·EX 10%)를 거꾸로 계산한 값
};
const RADAR = 1;  // 트레저 레이더 (Gatyaitembuy 1)
// 트레저 레이더 1개 = 1.6NP: 역습의 대갈이군(2장 70% / 3장 30%)에 쓰면 3장 확정 → 냥코 티켓 0.7장 이득 (커뮤니티 값, 사용자 결정)
const RADAR_NP = 1.6;
const RADAR_REF = new Set([1078, 1006]);  // 역습의 대갈이군 · 냥코티켓★찬스
// 스테이지에 트레저 레이더를 쓰면 드롭이 가장 많은 칸으로 확정. 레이더 1개(1.6NP)를 쓴 만큼 빼서 손익을 보여 준다
const radarBtn = (key, gain) => `<button class="np-more" data-rd="${key}" aria-pressed="${!!opt.radarOn[key]}" title="트레저 레이더를 쓰면 드롭 확정. 레이더 1개 = ${RADAR_NP}NP를 뺀 손익">트레저 레이더 ${opt.radarOn[key] ? "ON" : "OFF"} (${gain >= 0 ? "+" : ""}${n2(gain)}NP)</button>`;
const entryNp = (e, rareNp) => e[2] >= 0 ? e[4] : e[3] === 20 ? catTicketNp(rareNp) : e[3] === 21 ? rareNp
  : e[3] === RADAR ? (opt.npRadar ? RADAR_NP : 0) : xpNp(XP_ITEMS[e[3]]);
function setNp(set, rates, rareNp) {
  return rates.reduce((np, [p], g) => {
    const es = set.entries.filter(e => e[0] === g), w = es.reduce((a, e) => a + e[1], 0);
    return w ? np + p / 1e4 * es.reduce((a, e) => a + e[1] * entryNp(e, rareNp), 0) / w : np;
  }, 0);
}
function ticketGacha(d, sc, now, rareNp) {
  const known = new Map();  // "종류:세트" → 일정 데이터의 확률 (지금 열린 것 우선)
  for (const e of sc?.gatya || []) {
    if (e.end && Date.parse(e.end) <= now) continue;
    const open = Date.parse(e.start || 0) <= now;
    for (const s of e.sets) {
      const key = `${e.kind}:${s.id}`, cur = known.get(key);
      if (s.id >= 0 && (!cur || (open && !cur.open))) known.set(key, { rates: s.rates, open, start: e.start });
    }
  }
  const out = {};
  for (const [tid, g] of Object.entries(d.gacha)) {
    const keys = Object.keys(g.sets);
    const hit = keys.filter(k => known.has(k)).sort((a, b) => known.get(b).open - known.get(a).open)[0];
    const key = hit || keys.sort((a, b) => b.split(":")[1] - a.split(":")[1])[0];  // 없으면 가장 최근 세트
    const set = g.sets[key], kind = key.split(":")[0];
    const k = known.get(key);
    const wiki = !k && kind === "collab" ? EVENT_RATES[tid] : null;
    const slot = wiki ? wiki[0] : opt.eventChar;
    const rates = k?.rates || (kind === "collab" ? [[0, 0], [0, 0], [0, 0], [slot * 100, 0], [0, 0]] : null);
    const every = kind === "collab" ? (EVENT_RATES[tid]?.[1] ?? 10) : 0;
    // 이벤트 뽑기는 10번마다 한정 캐릭 하나가 확정 (나무위키 이벤트 뽑기 문서, 고양이 농가는 확정에서 빠짐)
    const pool = kind === "collab" ? set.entries.filter(e => e[2] >= 0 && !NO_GUARANTEE.has(e[2])) : [];
    const sure = pool.length ? pool.reduce((a, e) => a + e[4], 0) / pool.length : null;
    const base = rates ? setNp(set, rates, rareNp) : null;
    const auto = base == null ? null : sure == null || !every ? base : base * (every - 1) / every + sure / every, manual = opt.tNp[tid];
    out[tid] = { name: g.name, kind, set, rates, open: !!k?.open, start: k?.start, est: !k && !wiki, known: !!wiki, every, auto, manual: manual != null,
      np: manual ?? auto, chars: set.entries.filter(e => e[2] >= 0) };
  }
  return out;
}
// 순위표: 티켓마다 가장 좋은 스테이지 한 줄 (지금 열린 스테이지가 있으면 그중에서)
function eventRows(d, sc, now, tg) {
  const openMaps = new Set((sc?.sale || []).filter(e => openNow(e, now)).flatMap(e => e.maps));
  const rows = [], seen = new Set();
  for (const s of d.gachaStages) for (const tid of new Set([...Object.keys(s.t), ...Object.keys(s.ex?.t || {})])) {
    const t = tg[tid], n = stageTickets(s, tid);
    // 같은 이름으로 다시 열린 맵(복각)은 번호만 다르고 스테이지가 같다 → 한 번만
    const dup = `${s.name}|${s.stage}|${s.energy}|${s.t[tid]}|${JSON.stringify(s.ex)}|${tid}`;
    if (!t || !s.energy || seen.has(dup)) continue;
    seen.add(dup);
    const exP = s.ex ? exProb(s) : 0, xp = s.xp + (s.ex ? exP * s.ex.xp : 0);
    const got = [s.t[tid] && `${+s.t[tid].toFixed(2)}장`, s.ex?.t[tid] && exP && `EX ${+(exP * 100).toFixed(1)}% × ${s.ex.t[tid]}장`].filter(Boolean).join(" + ");
    rows.push({ group: LUCKY.has(tid) ? "lucky" : "event", name: `${t.name} — ${s.name}`, href: `#/stage/${s.map}/${s.i}`, open: openMaps.has(s.map), fold: `${s.name}|${tid}`,
      sub: `${s.stage} — ${t.name} ${got} × ${n2(t.np || 0)}NP${t.manual ? " (직접 입력)" : t.est ? " (확률 추정)" : ""}${opt.npXp ? ` + XP ${Math.round(xp).toLocaleString()}` : ""}`,
      ...(() => {
        const top = s.top?.[tid], key = `e${s.map}-${s.i}-${tid}`;
        const gain = top ? (top - (s.t[tid] || 0)) * (t.np || 0) - RADAR_NP : 0, on = top && opt.radarOn[key];
        return { np: n * (t.np || 0) + (on ? gain : 0) + xpNp(xp), rd: top ? radarBtn(key, gain) : "" };
      })(),
      energy: s.energy,
      extra: s.ex ? `<label class="np-exin" title="스테이지를 깬 뒤 EX 스테이지가 나올 확률. 게임 데이터 값은 ${s.ex.p}%">EX 출현 <input type="number" min="0" max="100" step="1" data-exm="${s.map}" value="${exPctOf(s)}">%</label>` : "" });
    rows.at(-1).extra = [rows.at(-1).rd, rows.at(-1).extra].filter(Boolean).join(" ");
  }
  // 티켓을 걸고 하는 스테이지 (한탕 오락실): 통솔력 0, 건 티켓보다 평균 몇 장 더 받는지(손익)를 NP로
  for (const b of d.bets || []) {
    const t = tg[b.item], got = b.t[b.item] || 0, net = got - b.cost;
    if (!t?.np) continue;
    rows.push({ group: "event", name: `${t.name} — ${b.name}`, href: `#/stage/${b.map}/${b.i}`, open: openMaps.has(b.map), fold: `${b.name}|${b.item}`,
      sub: `${b.stage} — ${t.name} ${b.cost}장 걸면 평균 ${+got.toFixed(1)}장 (${net >= 0 ? "+" : ""}${+net.toFixed(1)}장) × ${n2(t.np)}NP · 통솔력 없이 티켓만 걸어요`,
      np: net * t.np, energy: 0, bet: `${t.name} ${b.cost}장`, betCost: b.cost });
  }
  return rows;
}
// 티켓을 걸고 들어가는 스테이지 (한탕 오락실 등): 통솔력이 안 들어서 순위표 대신 여기 적는다
function betText(d, tid) {
  const bs = (d.bets || []).filter(b => b.item == tid && b.t[tid]);
  return bs.length ? `<br>티켓을 걸고 하는 스테이지: ${bs.map(b =>
    `<a href="#/stage/${b.map}/${b.i}">${esc(b.stage)}</a> ${b.cost}장 → 평균 ${+b.t[tid].toFixed(1)}장`).join(", ")}` : "";
}
function ticketPanel(d, tg) {
  const list = Object.entries(tg).sort((a, b) => (b[1].np ?? -1) - (a[1].np ?? -1) || a[0] - b[0]);
  if (!list.length) return "";
  const stagesOf = tid => d.gachaStages.filter(s => stageTickets(s, tid) && s.energy).sort((a, b) => stageTickets(b, tid) / b.energy - stageTickets(a, tid) / a.energy);
  return `<div class="panel"><h2>이벤트·럭키 티켓 1장 = NP <span class="ctl">${list.length}종</span></h2>
    <div class="table-wrap"><table class="en-table np-table np-tk"><thead><tr><th>티켓</th><th>1장 NP</th><th title="비워 두면 자동 계산값">직접 입력</th><th>나오는 캐릭</th><th>드롭 스테이지</th></tr></thead><tbody>
    ${list.map(([tid, t]) => {
      const g = GRADE[t.kind];
      const grades = t.rates ? t.rates.map(([p], i) => p ? `${g[i]} ${p / 100}%` : "").filter(Boolean).join(" · ") : "";
      const chars = t.chars.map(e => BYID.get(e[2])?.forms[0].name || `#${e[2]}`);
      const st = stagesOf(tid);
      const spec = t.set.special.map(([, n, name]) => `${name} ${n}개`).join(", ");
      return `<tr${t.open ? ` class="boss"` : ""}>
        <td class="en-name">${esc(t.name)}${t.open ? ` <span class="sc-open">지금 열림</span>` : ""}<br><small>${t.est ? (t.chars.length ? `확률 추정 (한정 캐릭 ${opt.eventChar}%)` : "지금 일정에 없음") : t.known ? `한정 캐릭터 ${t.rates[3][0] / 100}% (${TICKET_NOTE[tid]?.[0] === "est" ? "추정: 영상 수치 역산" : "나무위키"})` : grades}${t.chars.length && t.kind === "collab" ? (t.every ? ` · ${t.every}회마다 한정 캐릭 확정` : " · 한정 캐릭 확정 없음") : ""}${t.start && !t.open ? ` · ${t.start.slice(5, 10).replace("-", "/")} 시작` : ""}</small></td>
        <td data-l="1장 NP"><b>${t.np == null ? "-" : n2(t.np)}</b>${t.manual ? `<br><small>자동 ${t.auto == null ? "-" : n2(t.auto)}</small>` : ""}</td>
        <td data-l="직접 입력"><input class="np-tin" type="number" min="0" step="0.01" data-tnp="${tid}" value="${t.manual ? opt.tNp[tid] : ""}" placeholder="자동"></td>
        <td data-l="나오는 캐릭"><small>${chars.length ? esc(chars.join(", ")) : "캐릭 없음 (아이템·XP만)"}${betText(d, tid)}${spec ? `<br>특별 아이템 (이벤트마다 최대, 30회마다 확정): ${esc(spec)}` : ""}</small></td>
        <td data-l="드롭 스테이지"><small>${st.length ? `${st.length}곳 · 최고 통솔력 ${opt.perEnergy}당 ${n2(stageTickets(st[0], tid) / st[0].energy * opt.perEnergy)}장 (<a href="#/stage/${st[0].map}/${st[0].i}">${esc(st[0].name)} ${esc(st[0].stage)}</a>)` : "-"}</small></td></tr>`;
    }).join("")}
    </tbody></table></div></div>`;
}

// ---- XP 스테이지 (XP를 NP로 칠 때만). 광고 2배는 클리어 XP만 (s.ad = 클리어 XP) ----
function xpRows(d) {
  if (!opt.npXp) return [];
  return (d.xpStages || []).map(s0 => {
    const s = { clear: s0.xp, drop: 0, ...s0 };  // 옛 np.json(브라우저 캐시)엔 clear·drop이 없음
    // 클리어 XP는 광고로 딱 2배, 드롭 XP는 따로 (광고와 상관없음, 트레저 레이더를 쓰면 가장 큰 칸 확정)
    // 고양이 박사(아이템 4번, 비용 0으로 침): 클리어 XP 1.5배, 드롭 XP엔 안 붙음. 기본 켜짐
    const on = s.ad && !opt.xpAdOff[s.map], doc = !opt.xpDocOff[s.map];
    const clear = Math.floor(s.clear * opt.xpMult * (on ? 2 : 1) * (doc ? 1.5 : 1) * (opt.xpCombo ? 1.1 : 1) + 1e-6);
    const key = `x${s.map}-${s.i}`, rd = s.top && opt.radarOn[key], drop = rd ? s.top : s.drop;
    const gain = s.top ? xpNp(s.top - s.drop) - RADAR_NP : 0;
    const f = n => n.toLocaleString();
    return { group: "xp", name: s.name, href: `#/stage/${s.map}/${s.i}`, fold: `xp|${s.name}`,
      sub: `${s.stage} — XP ${f(clear + drop)} = 클리어 ${f(clear)} (${[`기본 ${f(s.clear)}`, `보너스 ${opt.xpMult}배`, on && "광고 2배", doc && "고양이 박사 1.5배", opt.xpCombo && "굳잡 1.1배"].filter(Boolean).join(" × ")}) + 드롭 ${rd ? "" : "평균 "}${f(drop)}${rd ? " (레이더 확정)" : ""}`
        + (s.once ? ` · ${f(s.once)} 칸은 맵이 열릴 때마다 1번` : ""),
      np: xpNp(clear + drop) - (rd ? RADAR_NP : 0), energy: s.energy,
      extra: [s.top ? radarBtn(key, gain) : "", s.ad ? `<button class="np-more" data-ad="${s.map}" aria-pressed="${on}" title="광고를 보면 클리어 XP 2배 (드롭 XP는 그대로)">광고 2배 ${on ? "ON" : "OFF"}</button>` : "",
        `<button class="np-more" data-doc="${s.map}" aria-pressed="${doc}" title="고양이 박사: 클리어 XP 1.5배 (드롭 XP는 그대로). 남아도는 아이템이라 비용 0">고양이 박사 ${doc ? "ON" : "OFF"}</button>`].filter(Boolean).join(" ") };
  });
}

// ---- 계산 기준 탭: 계산에 쓰는 값마다 출처와 믿을 만한 정도를 한 표로 ----
const BASIS_STATUS = {
  ok: ["확정", "게임 데이터·서버 데이터이거나 나무위키 등과 맞춰 본 값"],
  clash: ["출처 충돌", "출처마다 값이 달라서 하나를 골라 쓴 값"],
  set: ["설정값", "정해 두고 쓰는 값 (순위 탭 설정 아래에 설명)"],
  est: ["추정", "확인된 값이 없어서 짐작한 값 — 찾으면 바꿔야 함"],
};
// 이벤트 뽑기 티켓별 메모 (출처 충돌·추정 근거)
const TICKET_NOTE = {
  267: ["est", "공개된 확률 없음. 커뮤니티 영상 수치(1스테·EX 10% 기준 통솔력 400당 2.71NP)를 거꾸로 계산한 값 (캐릭 2종 × 2.5%). game8 경험담(거의 확정 틀에서만 나옴)과도 맞음"],
  163: ["est", "일본 위키(seesaawiki): 캐릭 각 2.5% (일본판 4종 = 10%). 한국판 최신 세트는 3종"],
  215: ["est", "확률을 적어 둔 곳 없음 (10회 확정만 game8에서 확인)"],
  178: ["est", "확률을 적어 둔 곳 없음 (10회 확정만 game8에서 확인)"],
  198: ["est", "확률을 적어 둔 곳 없음 (10회 확정만 game8에서 확인)"],
  259: ["clash", "나무위키: 50회마다 확정 / 일본 위키(seesaawiki): 확정 틀 없음 → 나무위키 값"],
};
function basisHtml(d, tg, rareRaw) {
  const rows = [
    ["뽑기·중복", "중복 캐릭 NP", `기본 ${d.dupe[0]} · EX ${d.dupe[1]} · 레어 ${d.dupe[2]} · 슈레 ${d.dupe[3]} · 울슈레 ${d.dupe[4]} · 레전드 ${d.dupe[5]}`, "게임 데이터 (unitbuy 58열), 나무위키 본능 문서와 일치", "ok"],
    ["뽑기·중복", "지금 열린 뽑기 확률", "배너마다 서버 값", "서버 일정 데이터 (gatya.tsv)", "ok"],
    ["뽑기·중복", "레어 뽑기 종류별 기준 확률", RARE_KINDS.map(([, n, r]) => `${n} ${r.join("/")}`).join(" · "), "커뮤니티 정리 (축제는 열릴 때만 서버에 나옴)", "set"],
    ["뽑기·중복", "레어 티켓 1장", `NP ${n2(rareRaw)} (${RARE_BEST[1]} ${RARE_BEST[2].join("/")} 기준)`, "가장 좋은 뽑기에 쓴다고 봄. 어디에 쓰든 상대 가치는 같아서 하나로 고정", "set"],
    ["뽑기·중복", "냥코 뽑기 구성", "기본 캐릭 9 + 파란구슬 9 / 뽑기+(우주편 3장 뒤) 10 + 9, 중복 1NP / 2NP", "나무위키 뽑기·본능 문서", "ok"],
    ["뽑기·중복", "파란구슬 → 레어 티켓", "5개 = 1장, 그 능력이 +10까지 다 올라가야 교환", "나무위키 자원 문서", "ok"],
    ["럭키·이벤트", "럭키 티켓 1장", "꼬맹이 9종 각 3.7% → 0.33NP", "게임 데이터 구성 + 서버 확률, 나무위키 표와 일치", "ok"],
    ["럭키·이벤트", "이벤트 뽑기에서 캐릭이 나오는 칸", "4번째 칸(울슈레 자리) = 한정 캐릭터", "게임 데이터 추론, 나무위키 확률표와 일치", "ok"],
    ["럭키·이벤트", "이벤트 뽑기 확정 틀", "대부분 10회마다 한정 캐릭 1개 (고양이 농가 제외)", "나무위키 이벤트 뽑기 문서, game8", "ok"],
    ["럭키·이벤트", "30회 특별 아이템 (레어 티켓·플래티넘 조각 등)", "NP에 안 넣음", "이벤트마다 개수 제한이 있어서 (사용자 결정)", "set"],
    ["스테이지", "스테이지 드롭 확률", "스테이지마다", "게임 데이터, 나무위키 시즌·발굴·육성 스테이지 문서와 대조해 일치", "ok"],
    ["스테이지", "EX 스테이지 출현율", "게임 데이터 값 (팩맨만 10%, 줄마다 바꿀 수 있음)", "게임 데이터 (스테이지 파일 \"EX出現率\"). 나무위키·game8은 팩맨 \"약 10%\"", "clash"],
    ["스테이지", "한탕 오락실", "10→11.7 · 30→32.5 · 100→125장", "게임 데이터, 나무위키와 일치", "ok"],
    ["스테이지", "역습의 대갈이군 · 대역습의 메타쿠마", "열릴 때마다 1번만", "나무위키 육성 스테이지 문서 · 사용자 확인 (데이터 플래그로는 구분 안 됨)", "ok"],
    ["본능옥·강습", "본능옥 분해 NP", `D ${d.gradeNp[0]} · C ${d.gradeNp[1]} · B ${d.gradeNp[2]} · A ${d.gradeNp[3]} · S ${d.gradeNp[4]}`, "게임 데이터 (equipmentgrade)", "ok"],
    ["본능옥·강습", "강습 EX 출현 확률", "Lv.1 1% … Lv.MAX 기원 59.4 · 정점 30.6 · 비경 10%", "게임 데이터 (EX_group), 나무위키 강습 문서와 일치", "ok"],
    ["환산", "리더쉽 1개", `통조림 ${opt.leaderCans} (통솔력 ${opt.maxEnergy} 채움)`, "설정", "set"],
    ["환산", "XP → NP (사당)", `100만 = ${XP_NP}NP${opt.npXp ? "" : " (지금은 안 침)"}`, "커뮤니티 (500만당 약 2.25NP)", "set"],
    ["환산", "트레저 레이더 1개", `${RADAR_NP}NP (역습의 대갈이군에 쓰는 기준)${opt.npRadar ? "" : " — 지금은 안 침"}`, "역습의 대갈이군에 쓰면 냥코 티켓 0.7장 이득 (0.7 × 2.27NP), 커뮤니티 값", "set"],
  ];
  // 이벤트 뽑기 티켓별 (캐릭이 있는 것만)
  for (const [tid, t] of Object.entries(tg)) {
    if (!t.chars.length || t.kind !== "collab") continue;
    const note = TICKET_NOTE[tid];
    const status = t.open || (t.start && !t.est && !t.known) ? "ok" : t.manual ? "set" : note ? note[0] : t.known ? "ok" : "est";
    const val = `${t.manual ? `직접 입력 ${opt.tNp[tid]}NP` : `한정 캐릭 ${t.rates[3][0] / 100}%${t.every ? `, ${t.every}회 확정` : ", 확정 없음"} → 1장 ${n2(t.np)}NP`}`;
    const src = t.open || (t.start && !t.est && !t.known) ? "서버 일정 데이터" : note ? note[1] : t.known ? "나무위키 이벤트 뽑기 문서" : `확률 정보 없음 — 기본 ${opt.eventChar}%로 추정`;
    if (!rows.some(r => r[1] === t.name && r[2] === val)) rows.push(["이벤트 뽑기", t.name, val, src, status]);  // 같은 이름 티켓(옛 맵·새 맵)은 한 줄
  }
  const order = { est: 0, clash: 1, set: 2, ok: 3 };
  const count = Object.fromEntries(Object.keys(BASIS_STATUS).map(k => [k, rows.filter(r => r[4] === k).length]));
  return `<div class="panel"><h2>계산 기준 <span class="ctl">${rows.length}개 · 추정 ${count.est} · 출처 충돌 ${count.clash}</span></h2>
    <p class="np-note">NP효율 계산에 쓰는 값과 출처예요. 추정·출처 충돌이 먼저 나와요. 더 정확한 값을 알면 알려 주세요.</p>
    <p class="np-legend">${Object.entries(BASIS_STATUS).map(([k, [n, t]]) => `<span class="np-st np-st-${k}" title="${esc(t)}">${n}</span> ${esc(t)}`).join("<br>")}</p>
    <div class="table-wrap"><table class="en-table np-table np-tk np-basis"><thead><tr><th>상태</th><th>분류</th><th>항목</th><th>쓰는 값</th><th>출처</th></tr></thead><tbody>
    ${rows.sort((a, b) => order[a[4]] - order[b[4]]).map(([g, name, val, src, st]) => `<tr>
      <td data-l="상태"><span class="np-st np-st-${st}">${BASIS_STATUS[st][0]}</span></td>
      <td data-l="분류"><small>${esc(g)}</small></td><td class="en-name" data-l="항목">${esc(name)}</td>
      <td data-l="쓰는 값"><small>${esc(val)}</small></td><td data-l="출처"><small>${esc(src)}</small></td></tr>`).join("")}
    </tbody></table></div></div>
    <div class="panel"><h2>계산 방법</h2><ul class="np-how">
      <li>NP로 칠 것: ${[opt.npRare && "레어 티켓 뽑기", opt.npRare && opt.npBlue && "파란구슬 → 레어 티켓", opt.npOrb && "본능옥 분해", opt.npXp && `XP (100만 = ${XP_NP}NP, XP 스테이지는 광고로 클리어 XP 2배 (순위표에서 맵마다 끌 수 있음))`, opt.npRadar && `트레저 레이더 (1개 = ${RADAR_NP}NP, 역습의 대갈이군에 쓰는 기준)`].filter(Boolean).join(", ") || "중복 캐릭만"}.
        꺼 둔 것은 NP 0으로 보고, NP가 0인 방법은 순위표에서 빠져요. 플래티넘 조각·리더쉽 같은 특별 아이템은 개수 제한이 있어서 넣지 않아요.</li>
      <li>중복 캐릭을 NP로 바꾸면 레어 ${d.dupe[2]}, 슈퍼레어 ${d.dupe[3]}, 울트라슈퍼레어 ${d.dupe[4]}, 레전드레어 ${d.dupe[5]} NP. 뽑기는 뽑은 캐릭이 전부 중복이라고 보고 서버 확률로 계산해요.</li>
      <li>본능옥을 NP로 바꾸면 D ${d.gradeNp[0]}, C ${d.gradeNp[1]}, B ${d.gradeNp[2]}, A ${d.gradeNp[3]}, S ${d.gradeNp[4]} NP. 합성하지 않고 바로 바꾼다고 봐요.</li>
      <li>강습은 클리어하면 EX 스테이지(기원·정점·비경)가 나올 수 있고, EX에서 본능옥이 나와요. EX 1회 NP 기대값: 기원 ${n2(d.exNp[0])}, 정점 ${n2(d.exNp[1])}, 비경 ${n2(d.exNp[2])}. EX 스테이지 통솔력은 넣지 않았어요.</li>
      <li>이벤트·럭키 티켓은 그 티켓 뽑기에서 나오는 캐릭을 전부 중복으로 보고 NP로 바꾼다고 계산해요 (XP·전투 아이템은 NP 0). 뽑기 구성은 게임 데이터, 확률은 일정 데이터(서버)에서 가져와요.
        지금 일정에 없는 이벤트 뽑기는 확률을 알 수 없어서 한정 캐릭 확률(기본 ${opt.eventChar}%)을 직접 넣은 값으로 추정해요. 스테이지를 깬 뒤 나오는 EX 스테이지(통솔력 0, 팩맨 파워 쿠키 10장 등)도 출현 확률만큼 더해요 (게임 데이터 확률, 팩맨은 10%. 순위표의 그 스테이지 줄에서 바꿀 수 있어요). 10번마다 한정 캐릭 하나가 확정으로 나오는 것도 넣었어요 (10번 중 9번은 확률대로, 1번은 확정). 30회마다 나오는 특별 아이템은 개수 제한이 있어서 넣지 않았어요.</li>
      <li>지도·보물이 잠든 섬 스테이지는 지도 아이템이나 이벤트가 있을 때만 할 수 있어요.</li>
    </ul></div>`;
}
function paintTabs(root, draw) {
  const box = root.querySelector("#npTabs");
  box.innerHTML = [["rank", "순위"], ["basis", "계산 기준"]].map(([k, l]) =>
    `<button class="chip" data-tab="${k}" aria-pressed="${opt.tab === k}">${l}</button>`).join("");
  box.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { opt.tab = b.dataset.tab; save(); draw(); });
}
