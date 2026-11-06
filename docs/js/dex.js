// 내 도감 — 보유 캐릭 관리
import { GD, FORM, RELEASES, esc, icon, rarBadge, traitChips, view, store, exportJson, chips, toggle, toast } from "./common.js";

const ui = { own: "owned", todo: new Set(), rar: new Set(), trait: new Set(), q: "", sort: "id" };

export function renderDex(root) {
  root.innerHTML = `
    <p class="crumb"><a href="#/">냥코위키</a><i>/</i><span>내 도감</span></p>
    <div class="page-head">
      <div><h1>내 도감</h1><p>보유 캐릭의 진화·레벨·본능을 관리해요. 카드를 누르면 상세 정보와 수정 화면이 나와요.</p></div>
      <div class="acts">
        <label class="btn primary">세이브 불러오기<input type="file" accept=".json,application/json" hidden data-import></label>
        <button class="btn" id="dExport">내보내기</button>
        <button class="btn danger" id="dReset">초기화</button>
      </div>
    </div>
    <p class="meta" id="dMeta"></p>
    <div class="stats" id="dStats"></div>
    <div class="filters">
      <div class="row">
        <input type="search" id="dQ" placeholder="이름 검색 (1·2·3진 이름 모두)" value="${esc(ui.q)}">
        <select id="dSort" aria-label="정렬">
          <option value="id">ID순</option><option value="rarity">레어도순</option>
          <option value="level">레벨 높은순</option><option value="levelAsc">레벨 낮은순</option>
        </select>
      </div>
      <div class="row" id="dOwn"><span class="lbl">보유</span></div>
      <div class="row" id="dTodo"><span class="lbl">할 일</span></div>
      <div class="row" id="dRar"><span class="lbl">레어도</span></div>
      <div class="row" id="dTrait"><span class="lbl">속성</span></div>
    </div>
    <p class="count" id="dCount"></p>
    <div class="grid" id="dGrid"></div>`;
  root.querySelector("#dSort").value = ui.sort;
  root.querySelector("#dQ").oninput = e => { ui.q = e.target.value.trim(); renderList(); };
  root.querySelector("#dSort").onchange = e => { ui.sort = e.target.value; renderList(); };
  root.querySelector("#dExport").onclick = exportJson;
  root.querySelector("#dReset").onclick = () => {
    if (!confirm("이 브라우저에 저장된 내 도감 데이터를 모두 지울까요?\n(필요하면 먼저 [내보내기]로 백업하세요)")) return;
    ui.own = "owned"; store.reset(); toast("초기화했어요.");
  };
  root.addEventListener("click", e => {
    if (e.target.closest("[data-manual]")) { ui.own = "all"; refresh(); toast("캐릭을 눌러서 보유·레벨을 입력하세요."); }
  });
  refresh();
  return refresh;  // 데이터가 바뀌면 다시 그리도록 라우터에 넘긴다
}

function refresh() {
  renderHeader(); buildFilters(); renderList();
}

function buildFilters() {
  const re = () => { buildFilters(); renderList(); };
  chips(document.getElementById("dOwn"), [["owned", "보유"], ["unowned", "미보유"], ["all", "전체"]], v => ui.own === v, v => { ui.own = v; re(); });
  chips(document.getElementById("dTodo"), [["ready", "지금 바로 진화 가능"], ["tf", "3진 레벨 충족"], ["ff", "4진 레벨 충족"], ["talent", "본능 미해방"], ["talentPart", "본능 미완료"], ["lv", "레벨 미만렙"]],
    v => ui.todo.has(v), v => { toggle(ui.todo, v); re(); });
  chips(document.getElementById("dRar"), GD.rarities.map((r, i) => [i, r]), v => ui.rar.has(v), v => { toggle(ui.rar, v); re(); });
  chips(document.getElementById("dTrait"), GD.traits.map(t => [t, t]), v => ui.trait.has(v), v => { toggle(ui.trait, v); re(); });
}

function matches(v) {
  const { c, o } = v;
  if (ui.own === "owned" && !o) return false;
  if (ui.own === "unowned" && o) return false;
  if (ui.rar.size && !ui.rar.has(c.rarity)) return false;
  for (const t of ui.trait) if (!v.traits.has(t)) return false;
  for (const t of ui.todo) {
    if (t === "ready" && !(v.tfReady || v.ffReady)) return false;
    if (t === "tf" && !v.tfTodo) return false;
    if (t === "ff" && !v.ffTodo) return false;
    if (t === "talent" && !v.talentNone) return false;
    if (t === "talentPart" && !v.talentPart) return false;
    if (t === "lv" && !(o && v.lvTotal < v.maxLv)) return false;
  }
  if (ui.q) {
    const q = ui.q.toLowerCase();
    if (!c.forms.some(f => f.name.toLowerCase().includes(q)) && String(c.id) !== q) return false;
  }
  return true;
}

function card(v) {
  const { c, o, fi } = v;
  const pct = o ? Math.round(v.lvTotal / v.maxLv * 100) : 0, isMax = o && v.lvTotal >= v.maxLv;
  const badges = [rarBadge(c), o && `<span class="form">${FORM[o.form]}</span>`,
    evoTag("3진", v.tf, c.tfLevel), evoTag("4진", v.ff, c.ffLevel)].filter(Boolean).join("");
  const lv = o ? `<div class="lvline"><span class="lv${isMax ? " max" : ""}">Lv ${o.level}${o.plus ? `<em>+${o.plus}</em>` : ""}</span>
      <span class="lvmax">/ ${c.maxLevel}${c.maxPlus ? "+" + c.maxPlus : ""}</span></div>
      <div class="bar${isMax ? " max" : ""}"><i style="width:${pct}%"></i></div>`
    : `<div class="sub">미보유</div>`;
  // 본능: 해방 개수만 요약하고, 레벨이 오른 것만 칩으로 (전체 목록은 상세 페이지에)
  let tal = "";
  if (v.talents.length) {
    const norm = v.talents.filter(t => !t.ultra), ultra = v.talents.filter(t => t.ultra);
    const on = l => l.filter(t => t.lv > 0).length, allFull = v.talents.every(t => t.lv >= t.max);
    const sum = o
      ? `본능 <b>${on(norm)}</b>/${norm.length}${ultra.length ? ` · <span class="u">초본능</span> <b>${on(ultra)}</b>/${ultra.length}` : ""}`
      : `본능 ${norm.length}개${ultra.length ? ` · 초본능 ${ultra.length}개` : ""}`;
    const chipsHtml = o ? v.talents.filter(t => t.lv > 0).map(t =>
      `<span class="t${t.lv >= t.max ? " full" : ""}${t.ultra ? " u" : ""}">${esc(t.name)} <b>${t.lv}</b>/${t.max}</span>`).join("") : "";
    tal = `<div class="tsum${o && allFull ? " full" : ""}">${sum}</div>${chipsHtml ? `<div class="tl">${chipsHtml}</div>` : ""}`;
  }
  return `<a class="card${o ? "" : " unowned"}" href="#/cat/${c.id}">${icon(c, fi)}<div class="body">
    <div class="title"><span class="name" title="${esc(c.forms.map(f => f.name).join(" → "))}">${esc(c.forms[fi].name)}</span><span class="cid">#${c.id}</span></div>
    <div class="badges">${badges}</div>${lv}${tal}${traitChips(v.traits)}</div></a>`;
}

// 진화 태그: 바로 가능(초록) / 재료 부족(주황, 부족분은 마우스 올리면) / 레벨 충족(재화 정보 없음·스테이지 진화)
function evoTag(label, e, need) {
  if (!e?.levelOk) return "";
  if (e.ok) return `<span class="tag ready">${label} 바로 가능</span>`;
  if (e.stageOnly) return `<span class="tag todo" title="열매가 아니라 스테이지 클리어 등으로 진화">${label} 가능 · 스테이지</span>`;
  if (e.known) return `<span class="tag todo" title="부족: ${esc(e.short.map(([n, k]) => `${n} ${k.toLocaleString()}`).join(", "))}">${label} · 재료 부족 ${e.short.length}종</span>`;
  return `<span class="tag todo">${label} 가능${need > 0 ? ` · Lv${need}` : ""}</span>`;
}

function welcome() {
  return `<div class="welcome">
    <h2>내 냥코 도감 만들기</h2>
    <p>캐릭을 하나하나 입력하지 않아도 돼요. 추출 도구로 내 세이브를 한 번에 불러올 수 있어요.</p>
    <ol>
      <li><a href="${RELEASES}">추출 도구(NyankoWiki)</a>를 받아 압축을 풉니다.</li>
      <li><b>NyankoWiki.exe</b>를 실행하고 방법을 고릅니다.
        <ul>
          <li><b>1번 블루스택</b>: 블루스택 5에 냥코대전쟁(한국판) 계정을 옮겨 한 번 실행한 뒤, 블루스택을 완전히 종료하고 고릅니다.</li>
          <li><b>2번 이어하기 코드</b>: 폰에서 발급한 이어하기 코드와 인증번호를 넣습니다. 받은 세이브를 그대로 다시 올려 <b>새 코드</b>를 보여 주니, 폰에서 그 코드로 이어하면 됩니다 (프로그램 폴더 <b>이어하기_코드.txt</b>에도 남아요).</li>
        </ul>
      </li>
      <li>프로그램 폴더에 <b>냥코_세이브.json</b>이 만들어집니다.</li>
      <li>그 파일을 이 화면에 끌어다 놓거나 [세이브 불러오기]를 누릅니다.</li>
    </ol>
    <div class="acts">
      <label class="btn primary">세이브 불러오기<input type="file" accept=".json,application/json" hidden data-import></label>
      <button class="btn" data-manual>직접 입력할게요</button>
    </div>
  </div>`;
}

function renderList() {
  const grid = document.getElementById("dGrid"), count = document.getElementById("dCount");
  if (!grid) return;
  if (!store.data && ui.own === "owned") { count.textContent = ""; grid.innerHTML = welcome(); return; }
  const list = GD.cats.map(view).filter(matches);
  const s = ui.sort;
  if (s === "rarity") list.sort((a, b) => b.c.rarity - a.c.rarity || a.c.id - b.c.id);
  if (s === "level") list.sort((a, b) => b.lvTotal - a.lvTotal || a.c.id - b.c.id);
  if (s === "levelAsc") list.sort((a, b) => a.lvTotal - b.lvTotal || a.c.id - b.c.id);
  count.textContent = `${list.length}마리 표시`;
  grid.innerHTML = list.length ? list.map(card).join("") : `<div class="empty">조건에 맞는 캐릭이 없습니다</div>`;
}

function renderHeader() {
  const meta = document.getElementById("dMeta"), st = document.getElementById("dStats");
  document.getElementById("dExport").disabled = !store.data;
  document.getElementById("dReset").disabled = !store.data;
  if (!store.data) { meta.textContent = ""; st.innerHTML = ""; return; }
  const m = store.data.meta, fmt = s => s ? s.slice(0, 16).replace("T", " ") : "?";
  meta.textContent = [m.source, m.saveModified && `세이브 ${fmt(m.saveModified)}`,
    m.updatedAt && `마지막 수정 ${fmt(new Date(m.updatedAt).toLocaleString("sv"))}`].filter(Boolean).join(" · ");
  const mine = GD.cats.map(view).filter(v => v.o);
  const f = [0, 1, 2, 3].map(i => mine.filter(v => v.o.form === i).length);
  const stat = (label, val, hot) => `<div class="stat${hot ? " hot" : ""}"><small>${label}</small><b>${val}</b></div>`;
  const tf = mine.filter(v => v.tfTodo).length, tn = mine.filter(v => v.talentNone).length;
  const ready = mine.filter(v => v.tfReady || v.ffReady).length, inv = store.data.inv;
  const cur = inv?.currency || {};
  st.innerHTML = [
    stat("보유", `${mine.length}<span> / ${GD.cats.length}</span>`),
    stat("진화", `${f[0]}<span> · </span>${f[1]}<span> · </span>${f[2]}${f[3] ? `<span> · </span>${f[3]}` : ""}<span> (1·2·3${f[3] ? "·4" : ""}진)</span>`),
    inv ? stat("지금 바로 진화", ready, ready > 0) : stat("3진 레벨 충족", tf, tf > 0),
    stat("본능 미해방", tn, tn > 0),
    inv && stat("경험치", (cur.xp ?? 0).toLocaleString()),
    inv && stat("NP", (cur.np ?? 0).toLocaleString()),
    stat("통조림", Number(cur.catfood ?? m.catfood ?? 0).toLocaleString()),
    `<a class="stat link" href="#/plan"><small>${inv ? "보유 재료 · 육성 계획" : "재화·재료 입력"}</small><b>열기 →</b></a>`,
  ].filter(Boolean).join("");
}
