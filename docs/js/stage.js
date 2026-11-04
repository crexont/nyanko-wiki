// 스테이지 — 분류·맵 목록, 맵(스테이지 목록), 스테이지 상세(출현 적·드롭, 내 캐릭 사거리 비교)
import { GD, BYID, esc, store, traitChips, itemIcon } from "./common.js";
import { loadEnemies, enemyIcon, enemyHp, enemyAtk, enemyCycle } from "./enemy.js";

let indexPromise;
const catPromises = {};
export const loadIndex = () => indexPromise ??= fetch("data/stages/index.json").then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
let namesPromise;
const loadNames = () => namesPromise ??= fetch("data/stages/stage_names.json").then(r => r.json());
const loadCat = code => catPromises[code] ??= fetch(`data/stages/${code}.json`).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
let unitsPromise;
const loadUnits = () => unitsPromise ??= fetch("data/units.json").then(r => r.json());

// 맵 번호 앞자리 → 분류 코드 (build_stages.py CATEGORIES 와 같다)
const PREFIX = { 3: "MS", 20: "Z", 21: "Z", 22: "Z", 23: "Z", 0: "N", 13: "NA", 34: "ND", 1: "S", 2: "C", 24: "A", 27: "CA", 25: "H", 31: "Q", 4: "RE", 14: "B",
                 7: "V", 36: "SR", 37: "G", 30: "DM", 33: "L", 6: "T", 11: "R", 12: "M" };
const codeOf = mid => PREFIX[Math.floor(mid / 1000)];
// 900초(27000F) 이상 기다렸다 나오는 적 (간판 아가씨 등 시간 끌기 방지용): 출현 적 표엔 남기고
// 사거리 비교·아웃레인지·가장 긴 적 사거리·속성 대응 계산에서는 뺀다
const LATE_F = 27000;
const sec = f => { const s = (f / 30).toFixed(2).replace(/\.?0+$/, ""); return `${s}초`; };
const num = n => Math.floor(n).toLocaleString();
const failed = (root, what) => { root.innerHTML = `<div class="empty">${what} 데이터를 불러오지 못했어요. 새로고침해 주세요.</div>`; };
// 냥코DB(일본판) 스테이지 주소: s{맵번호÷1000 (2자리)}{맵번호%1000 (3자리)}-{스테이지+1 (2자리)}.
// 좀비 습격은 메인 스토리 번호 + z (미래편 1장 = 03003z). 세계편·세계편 좀비는 한국판 전용 지도라 없다.
// 개다래·엑스트라와 아래 맵들은 2026-11-03 냥코DB 스테이지 목록에 없던 것 (한국판 전용·옛 버전)
const NO_DB = new Set([1037, 1071, 1139, 1144, 1224, 1225, 1267, 1293, 1310, 1311, 2079, 2105, 2130, 2131, 2212, 2213, 2214, 2215,
  24068, 27006, 27016, 25000, 25036, 25037, 25038, 25039, 25040, 25041, 25042, 25043, 25044, 25045, 25046, 25047, 25048, 25049,
  25050, 25055, 25067, 25068, 25069, 11010, 3000, 3001, 3002, 20000, 20001, 20002, 22001, 22002, 23000]);
function dbStageUrl(mid, si) {
  const code = codeOf(mid);
  if (NO_DB.has(mid) || code === "B" || code === "RE") return null;
  const map = code === "Z" ? `03${String(3 + (Math.floor(mid / 1000) - 21) * 3 + mid % 1000).padStart(3, "0")}z`
    : String(Math.floor(mid / 1000)).padStart(2, "0") + String(mid % 1000).padStart(3, "0");
  return `https://battlecats-db.com/stage/s${map}-${String(si + 1).padStart(2, "0")}.html`;
}
const itemName = (idx, id) => idx.items[id] ?? GD.items?.[id] ?? `아이템 ${id}`;
// 입장 비용: 통솔력, 또는 아이템으로 들어가는 스테이지 (통솔력 칸 = 아이템 번호 × 1000 + 개수, 한탕 오락실 259100 = 전설의 돈다발 100개)
const ITEM_COST = 100000;
const costText = (idx, e) => e == null ? "통솔력 -" : e >= ITEM_COST ? `${itemName(idx, Math.floor(e / 1000))} ${e % 1000}개` : `통솔력 ${e}`;

// 드롭 보상 한 칸: 아이템(번호 < 1000) 또는 캐릭(1000 이상: 번호 − 1000 / 10000 이상: 번호 − 10000)
function rewardHtml(idx, [id, amount, chance], all) {
  let icon = "", name;
  if (id >= 1000) {  // 캐릭 드롭: 드롭 번호 → 캐릭 ID (drop_chara.csv)
    const c = BYID.get(idx.chara?.[id]);
    name = c ? c.forms[0].name : `캐릭 #${id}`;
    icon = c?.forms[0].icon ? `<img class="item-ic" src="icons/${c.id}_0.png" alt="">` : "";
    if (c) name = `<a href="#/cat/${c.id}">${esc(name)}</a>`;
  } else if (id === 6) {
    name = `경험치 +${num(amount)}`; amount = 1;
    icon = itemIcon(id, "경험치");
  } else {
    name = esc(itemName(idx, id));
    icon = itemIcon(id, itemName(idx, id));
  }
  const pct = all ? "확정" : chance == null ? "" : `${chance}%`;
  return `<span class="reward">${icon}<span>${name}${amount > 1 ? ` ×${num(amount)}` : ""}</span>${pct ? `<small>${pct}</small>` : ""}</span>`;
}

// ---- 분류·맵 목록 ----
const ui = { code: "MS", q: "" };

export function renderStages(root) {
  root.innerHTML = `
    <p class="crumb"><a href="#/">냥코위키</a><i>/</i><span>스테이지</span></p>
    <div class="page-head"><div><h1>스테이지</h1><p>레전드·이벤트·콜라보 등 스테이지별 출현 적, 배율, 드롭 보상. 내 캐릭과 적 사거리도 비교할 수 있어요.</p></div></div>
    <div class="filters"><div class="row"><input type="search" id="sQ" placeholder="맵·스테이지 이름 검색 (전체 분류에서)" value="${esc(ui.q)}"></div>
      <div class="row" id="sCats"></div></div>
    <div id="sMaps"><div class="empty">불러오는 중…</div></div>`;
  loadIndex().then(idx => {
    const draw = () => {
      root.querySelector("#sCats").innerHTML = idx.categories.map(c =>
        `<button class="chip" data-code="${c.code}" aria-pressed="${!ui.q && c.code === ui.code}">${esc(c.name)} <small>${c.maps.length}</small></button>`).join("");
      const q = ui.q.toLowerCase();
      const groups = q ? idx.categories.map(c => [c, c.maps.filter(m => m[1].toLowerCase().includes(q))]).filter(([, m]) => m.length)
        : idx.categories.filter(c => c.code === ui.code).map(c => [c, c.maps]);
      const mapHtml = groups.map(([c, maps]) => `
        <div class="panel"><h2>${esc(c.name)} <span class="ctl">${maps.length}개 맵</span></h2>
          <div class="map-list">${maps.map(([mid, name, n]) => `<a href="#/stage/${mid}"><span>${esc(name)}</span><small>${n}스테이지</small></a>`).join("")}</div></div>`).join("");
      root.querySelector("#sMaps").innerHTML = q ? `<div id="sStageHits"></div>${mapHtml}` : mapHtml;
      if (q) {
        // 스테이지 이름: 검색할 때만 이름 목록을 받는다
        loadNames().then(names => {
          if (ui.q.toLowerCase() !== q) return;
          const where = new Map(idx.categories.flatMap(c => c.maps.map(([mid, n]) => [mid, { c: c.name, n }])));
          const hits = [];
          for (const [mid, list] of Object.entries(names)) {
            const w = where.get(+mid); if (!w) continue;
            for (const [si, sn] of list) if (sn.toLowerCase().includes(q)) hits.push({ mid: +mid, si, sn, ...w });
          }
          const LIMIT = 60;
          const box = root.querySelector("#sStageHits");
          if (box) box.innerHTML = hits.length ? `<div class="panel"><h2>스테이지 <span class="ctl">${hits.length}개${hits.length > LIMIT ? ` 중 ${LIMIT}개` : ""}</span></h2>
            <div class="map-list">${hits.slice(0, LIMIT).map(h => `<a href="#/stage/${h.mid}/${h.si}"><span>${esc(h.sn)}<small class="sub-map">${esc(h.c)} · ${esc(h.n)}</small></span></a>`).join("")}</div></div>` : "";
          if (!hits.length && !groups.length) root.querySelector("#sMaps").innerHTML = `<div class="empty">"${esc(ui.q)}"에 맞는 맵·스테이지가 없어요.</div>`;
        }).catch(() => {});
      }
      root.querySelectorAll("[data-code]").forEach(b => b.onclick = () => { ui.code = b.dataset.code; ui.q = ""; root.querySelector("#sQ").value = ""; draw(); });
    };
    root.querySelector("#sQ").oninput = e => { ui.q = e.target.value.trim(); draw(); };
    draw();
  }).catch(() => failed(root, "스테이지"));
  return null;
}

// ---- 맵: 스테이지 목록 ----
export function renderMap(root, mid) {
  root.innerHTML = `<div class="empty">불러오는 중…</div>`;
  const code = codeOf(mid);
  if (!code) { root.innerHTML = `<div class="empty">맵을 찾을 수 없어요. <a href="#/stages">스테이지 목록으로</a></div>`; return null; }
  Promise.all([loadIndex(), loadCat(code), loadEnemies()]).then(([idx, cat, { byId }]) => {
    const m = cat[mid], c = idx.categories.find(x => x.code === code);
    if (!m) { root.innerHTML = `<div class="empty">맵을 찾을 수 없어요. <a href="#/stages">스테이지 목록으로</a></div>`; return; }
    ui.code = code;
    root.innerHTML = `
      <p class="crumb"><a href="#/">냥코위키</a><i>/</i><a href="#/stages">스테이지</a><i>/</i><span>${esc(c.name)}</span></p>
      <div class="page-head"><div><h1>${esc(m.n)}</h1><p>${esc(c.name)} · ${m.stages.length}스테이지${m.stars.length > 1 ? ` · ★${m.stars.length}까지 (${m.stars.map(s => s + "%").join(" / ")})` : ""}</p></div></div>
      <div class="stage-list">${m.stages.map(s => {
        const boss = s.en.filter(e => e[6]).map(e => byId.get(e[0]));
        const show = [...new Map(s.en.map(e => [e[0], byId.get(e[0])])).values()].filter(Boolean).slice(0, 8);
        return `<a class="stage-row" href="#/stage/${mid}/${s.i}">
          <span class="no">${s.i + 1}</span>
          <span class="body"><b>${esc(s.n)}</b>
            <small>${esc(costText(idx, s.energy))} · 성 체력 ${s.time ? "무한" : num(s.hp)}${boss.length ? ` · 보스 ${boss.map(e => esc(e?.name ?? "?")).join(", ")}` : ""}</small></span>
          <span class="ens">${show.map(e => enemyIcon(e, "sm")).join("")}</span></a>`;
      }).join("")}</div>`;
    document.title = `${m.n} - 냥코위키`;
  }).catch(() => failed(root, "스테이지"));
  return null;
}

// ---- 스테이지 상세 ----
const st = { key: null, star: 0 };

export function renderStage(root, mid, si) {
  const code = codeOf(mid);
  if (st.key !== `${mid}/${si}`) Object.assign(st, { key: `${mid}/${si}`, star: 0 });
  root.innerHTML = `<div class="empty">불러오는 중…</div>`;
  const draw = () => Promise.all([loadIndex(), loadCat(code), loadEnemies()]).then(([idx, cat, en]) => {
    const m = cat?.[mid], s = m?.stages.find(x => x.i === si);
    if (!s) { root.innerHTML = `<div class="empty">스테이지를 찾을 수 없어요. <a href="#/stages">스테이지 목록으로</a></div>`; return; }
    paint(root, idx, mid, m, s, en.byId);
  }).catch(() => failed(root, "스테이지"));
  draw();
  return draw;
}

function paint(root, idx, mid, m, s, byId) {
  const c = idx.categories.find(x => x.code === codeOf(mid));
  const starPct = m.stars[st.star] ?? 100;
  const pos = m.stages.findIndex(x => x.i === s.i), prev = m.stages[pos - 1], next = m.stages[pos + 1];
  // 출현 적: 같은 적이 여러 줄이면 줄마다 따로 (배율·조건이 다를 수 있다)
  const rows = s.en.map(([eid, count, first, rmin, rmax, basePct, boss, mag, atkMag, kill, isBase]) => {
    const e = byId.get(eid);
    const hpPct = mag * starPct / 100, atkPct = atkMag * starPct / 100;
    const hp = e ? enemyHp(e, hpPct) : 0, atk = e ? e.atk.reduce((a, b) => a + enemyAtk(b, atkPct), 0) : 0;
    const cyc = e ? enemyCycle(e) : null;
    return { e, eid, count, first, rmin, rmax, basePct, boss, hpPct, atkPct, hp, atk, kill, isBase,
             dps: cyc ? Math.floor(atk * 30 / cyc) : null };
  });
  const enemies = [...new Map(rows.filter(r => r.e).map(r => [r.eid, r.e])).values()];
  const inPlay = [...new Map(rows.filter(r => r.e && r.first < LATE_F).map(r => [r.eid, r.e])).values()];
  const hasLate = rows.some(r => r.first >= LATE_F);
  const traits = [...new Set(enemies.flatMap(e => e.traits))];
  const pctText = r => r.hpPct === r.atkPct ? `${num(r.hpPct)}%` : `체력 ${num(r.hpPct)}%<br>공격 ${num(r.atkPct)}%`;
  const spawn = r => {
    const when = r.first < 0 ? `성 체력 ${r.basePct}% 이하 후 ${sec(-r.first)}` : r.basePct < 100 ? `성 체력 ${r.basePct}% 이하` : r.first ? sec(r.first) : "시작";
    const again = r.count === 1 ? "" : r.rmin === r.rmax ? ` · ${sec(r.rmin)}마다` : ` · ${sec(r.rmin)}~${sec(r.rmax)}마다`;
    return `${when}${again}${r.kill ? ` · ${r.kill}마리 처치 후` : ""}`;
  };

  root.innerHTML = `
    <p class="crumb"><a href="#/">냥코위키</a><i>/</i><a href="#/stages">스테이지</a><i>/</i><a href="#/stage/${mid}">${esc(m.n)}</a><i>/</i><span>${esc(s.n)}</span></p>
    <div class="page-head"><div><h1>${esc(s.n)}</h1><p>${esc(c.name)} · ${esc(m.n)} ${s.i + 1}번째 스테이지</p></div>
      <div class="acts">${prev ? `<a class="btn" href="#/stage/${mid}/${prev.i}">← 이전</a>` : ""}${next ? `<a class="btn" href="#/stage/${mid}/${next.i}">다음 →</a>` : ""}</div></div>
    ${m.stars.length > 1 ? `<div class="seg star-seg" role="group" aria-label="난이도">${m.stars.map((p, i) =>
      `<button data-star="${i}" aria-pressed="${i === st.star}">★${i + 1} <small>${p}%</small></button>`).join("")}</div>` : ""}
    <div class="cols">
      <div>
        <div class="panel"><h2>출현 적 <span class="ctl">${enemies.length}종 · 한 번에 최대 ${s.max}마리</span></h2>
          <div class="table-wrap"><table class="en-table"><thead><tr><th>적</th><th>배율</th><th>체력</th><th>공격력</th><th>DPS</th><th>사거리</th><th title="내 도감 보유 캐릭 중 이 적보다 사거리가 긴 캐릭 수">아웃레인지</th><th>수</th><th>출현</th></tr></thead><tbody>
          ${rows.map(r => `<tr class="${r.boss ? "boss" : ""}${r.first >= LATE_F ? " late" : ""}">
            <td class="en-name"><a href="#/enemy/${r.eid}">${enemyIcon(r.e, "sm")}<span>${esc(r.e?.name ?? `적 #${r.eid}`)}${r.boss ? `<em>보스</em>` : ""}${r.isBase ? `<em>성</em>` : ""}${r.first >= LATE_F ? `<em class="late-tag">${Math.round(r.first / 1800)}분 뒤 등장</em>` : ""}</span></a>
              ${r.e?.traits.length ? `<span class="trs">${r.e.traits.map(t => `<span class="tr mini" style="--c:var(--tr-${t})">${t}</span>`).join("")}</span>` : ""}</td>
            <td data-l="배율">${pctText(r)}</td><td data-l="체력">${num(r.hp)}</td><td data-l="공격력">${num(r.atk)}</td><td data-l="DPS">${r.dps == null ? "-" : num(r.dps)}</td>
            <td data-l="사거리">${r.e ? r.e.range + (r.e.ld ? `<br><small>(${Math.min(r.e.ld[0], r.e.ld[0] + r.e.ld[1])}~${Math.max(r.e.ld[0], r.e.ld[0] + r.e.ld[1])})</small>` : "") : "-"}</td>
            ${r.first >= LATE_F ? `<td class="skip" data-l="아웃레인지" title="오래 기다려야 나오는 적이라 사거리 비교에서 뺐어요">제외</td>` : `<td class="outr" data-l="아웃레인지" data-r="${r.e?.range ?? 0}">-</td>`}
            <td data-l="수">${r.count === 0 ? "무한" : r.count}</td><td class="spawn" data-l="출현">${spawn(r)}</td></tr>`).join("")}
          </tbody></table></div>
          <p class="note">배율은 ${m.stars.length > 1 ? `★${st.star + 1}(${starPct}%)` : "기본"} 기준이에요. 아웃레인지는 내 도감 보유 캐릭(지금 진화 단계) 중 그 적보다 사거리가 긴 캐릭 수예요.${hasLate ? " \"N분 뒤 등장\" 적(간판 아가씨 등)은 스테이지를 오래 끌 때만 나와서 사거리 비교·아웃레인지·속성 대응에서 뺐어요." : ""} 적 이름을 누르면 능력까지 볼 수 있어요.</p>
        </div>
        <div class="panel" id="rangeCmp"><h2>사거리 비교 <span class="ctl">이 스테이지 적 vs 내 캐릭</span></h2><div class="empty">불러오는 중…</div></div>
      </div>
      <div>
        <div class="panel"><h2>스테이지 정보</h2><dl class="kv">
          <dt>${s.energy >= ITEM_COST ? "입장" : "통솔력"}</dt><dd>${s.energy >= ITEM_COST ? esc(costText(idx, s.energy).replace(/^통솔력 /, "")) : s.energy ?? "-"}</dd>
          ${s.xp ? `<dt>경험치</dt><dd>${num(s.xp)}</dd>` : ""}
          <dt>성 체력</dt><dd>${s.time ? "무한 (시간 제한)" : num(s.hp)}</dd>
          <dt>스테이지 길이</dt><dd>${num(s.w)}</dd>
          <dt>최대 적 수</dt><dd>${s.max}</dd>
          ${s.time ? `<dt>제한 시간</dt><dd>${s.time}분</dd>` : ""}
          ${s.nc ? `<dt>이어하기</dt><dd>불가</dd>` : ""}
          ${s.bg ? `<dt>보스 가드</dt><dd>있음 (보스가 있으면 성을 칠 수 없음)</dd>` : ""}
        </dl>${dbStageUrl(mid, s.i) ? `<p style="margin:12px 0 0"><a class="btn" href="${dbStageUrl(mid, s.i)}" target="_blank" rel="noopener">냥코DB에서 보기 ↗</a></p>` : ""}</div>
        ${s.drop?.length ? `<div class="panel"><h2>드롭 보상</h2><div class="rewards">${s.drop.map(d => rewardHtml(idx, d, s.dropAll)).join("")}</div>
          ${s.dropOnce ? `<p class="note">첫 번째 보상은 처음 한 번만 얻을 수 있어요.</p>` : ""}</div>` : ""}
        ${traits.length ? `<div class="panel"><h2>적 속성</h2>${traitChips(traits)}<div id="counters"></div></div>` : ""}
      </div>
    </div>`;
  document.title = `${s.n} - 냥코위키`;
  root.querySelectorAll("[data-star]").forEach(b => b.onclick = () => { st.star = +b.dataset.star; paint(root, idx, mid, m, s, byId); });
  paintMine(root, rows, inPlay, [...new Set(inPlay.flatMap(e => e.traits))]);
}

// 내 캐릭(내 도감 보유, 지금 진화 단계)의 사거리·속성 대응 — 내 도감이 비어 있으면 안내만
function paintMine(root, rows, enemies, traits) {
  const box = root.querySelector("#rangeCmp"); if (!box) return;
  const owned = Object.entries(store.data?.cats || {}).map(([id, o]) => [BYID.get(+id), o]).filter(([c]) => c);
  const enemyRanges = enemies.map(e => ({ e, r: e.range, far: e.ld ? Math.max(e.ld[0], e.ld[0] + e.ld[1]) : e.range })).sort((a, b) => b.r - a.r);
  const maxEnemy = enemyRanges[0]?.r ?? 0;
  if (!owned.length) {
    box.innerHTML = `<h2>사거리 비교</h2>${rangeBars(enemyRanges.map(x => ({ label: x.e.name, icon: enemyIcon(x.e, "sm"), r: x.r, cls: "e" })), maxEnemy)}
      <p class="note">내 도감에 캐릭을 넣으면, 이 적들보다 사거리가 긴 내 캐릭을 같이 보여줘요. <a href="#/dex">내 도감</a></p>`;
    return;
  }
  loadUnits().then(units => {
    const mine = owned.map(([c, o]) => {
      const fi = Math.min(o.form, c.forms.length - 1), f = units[c.id]?.forms[fi];
      return f ? { c, fi, name: c.forms[fi].name, r: f.range, ab: f.ab, traits: c.forms[fi].traits } : null;
    }).filter(Boolean).sort((a, b) => b.r - a.r);
    const longer = mine.filter(x => x.r > maxEnemy);
    // 적마다: 사거리가 더 긴 내 캐릭 수 (표의 "아웃레인지" 칸)
    root.querySelectorAll("td.outr").forEach(td => {
      const n = mine.filter(x => x.r > +td.dataset.r).length;
      td.textContent = n ? `${n}마리` : "없음";
      td.classList.toggle("none", !n);
    });
    const top = [...longer.slice(0, 12)];
    const bars = [...enemyRanges.map(x => ({ label: x.e.name, icon: enemyIcon(x.e, "sm"), r: x.r, cls: "e" })),
                  ...top.map(x => ({ label: x.name, icon: `<img class="eicon sm cat" src="icons/${x.c.id}_${x.fi}.png" alt="">`, r: x.r, cls: "c", href: `#/cat/${x.c.id}` }))]
      .sort((a, b) => b.r - a.r);
    box.innerHTML = `<h2>사거리 비교 <span class="ctl">가장 긴 적 사거리 ${maxEnemy}</span></h2>
      ${rangeBars(bars, Math.max(...bars.map(b => b.r), 1))}
      <p class="note">${longer.length ? `내 캐릭 중 ${longer.length}마리가 이 스테이지 모든 적보다 사거리가 길어요${longer.length > top.length ? ` (긴 순서로 ${top.length}마리만 표시)` : ""}.` : "이 스테이지 적보다 사거리가 긴 내 캐릭이 없어요."} 원거리·전방위 공격은 반영하지 않은 기본 사거리예요.</p>`;
    // 속성 대응: 이 스테이지 적 속성을 타겟으로 하는 내 캐릭 (엄청 강하다·초 데미지·맷집 등)
    const cnt = root.querySelector("#counters");
    if (cnt && traits.length) {
      const KEYS = { strong: "엄강", massive: "초뎀", insane: "초극뎀", resist: "맷집", tough: "초맷집", only: "타겟 한정" };
      const fit = mine.map(x => {
        const hit = x.traits.filter(t => traits.includes(t));
        const keys = x.ab.map(a => KEYS[a[0]]).filter(Boolean);
        return hit.length && keys.length ? { ...x, hit, keys } : null;
      }).filter(Boolean).slice(0, 16);
      cnt.innerHTML = `<h3 class="sum-title" style="margin-top:14px">이 속성을 상대하는 내 캐릭</h3>${fit.length
        ? `<div class="counter-list">${fit.map(x => `<a href="#/cat/${x.c.id}"><img class="eicon sm cat" src="icons/${x.c.id}_${x.fi}.png" alt=""><span>${esc(x.name)}<small>${x.hit.join("·")} · ${x.keys.join("·")}</small></span></a>`).join("")}</div>`
        : `<p class="note" style="margin:0">내 캐릭 중 이 속성을 타겟으로 하는 캐릭이 없어요.</p>`}`;
    }
  }).catch(() => { box.innerHTML = `<h2>사거리 비교</h2><p class="note">캐릭터 데이터를 불러오지 못했어요.</p>`; });
}

function rangeBars(items, max) {
  return `<div class="range-bars">${items.map(b => `<${b.href ? `a href="${b.href}"` : "div"} class="rb ${b.cls}">
    <span class="lbl">${b.icon}<span>${esc(b.label)}</span></span>
    <span class="bar"><i style="width:${Math.max(2, b.r / max * 100)}%"></i><b>${b.r}</b></span></${b.href ? "a" : "div"}>`).join("")}</div>`;
}
