"""NP효율 페이지용 데이터를 빌드한다 (개발용, build_stages.py 다음에 실행).

- 중복 캐릭 NP: unitbuy.csv 58열 (레어도 13열별로 모은다)
- 본능옥 분해 NP: equipmentgrade.csv 2열 (D C B A S), 본능옥 등급: equipmentlist.json "ID"[번호].gradeID
- 본능옥 드롭: 스테이지 보상 아이템 30000 + 본능옥 번호 (docs/data/stages/*.json)
- 강습 → EX 스테이지: EX_group.csv `100, 강습 맵, 스테이지, (EX 번호, %)…`
  쌍을 앞에서부터 남은 확률에 차례로 굴린다 (마지막은 100 = 나머지 전부). EX 번호가 큰 쪽이 비경 → 정점 → 기원.
- 고양이 드링크 A 값: itemShopData.tsv (가격 ÷ 개수)

출력: docs/data/np.json
사용: python tools/build_np.py [--version 15.6.0]
"""
from __future__ import annotations

import argparse
import collections
import json
import os

from build_gamedata import SITE, game_data_dir, read
from build_stages import CATEGORIES, SKIP_FILES, data_lines, ints, parse_reward

ORB = 30000          # 보상 아이템 번호 - ORB = 본능옥 번호
XP_DROP = 6          # 스테이지 보상 6 = XP (개수 = XP 양)
XP_MAPS = 20         # 경험치 스테이지는 효율 좋은 맵 이만큼만
CAT_TICKET, RARE_TICKET = 20, 21
DRINK_A = 55
ITEM_COST = 100000   # 통솔력 칸이 이 이상이면 아이템 입장 (아이템 번호 × 1000 + 개수)
LIMITED = 3          # 이벤트 뽑기에서 캐릭이 나오는 등급 칸 (울슈레 자리 = 한정 캐릭터)
# 강습 EX 스테이지 (기원·정점·비경 × 6속성). 같은 이름의 지도 스테이지(25009~)와 드롭이 달라서 번호로 고른다.
EX_MAPS = range(25033, 25051)
# 재회의 지도: 복귀 유저에게만 주는 지도라 비교에서 뺀다 (사용자 결정)
SKIP_MAPS = {25070, 25071, 25072}
# 1회 한정 보상이지만 열릴 때마다 다시 받을 수 있는 맵 (대역습의 메타쿠마: 비정기, 냥코 티켓 5장 확정)
OPEN_ONCE = {1173}


def stage_files(out_dir: str):
    for f in sorted(os.listdir(out_dir)):
        if f.endswith(".json") and f not in SKIP_FILES:
            yield f[:-5], json.load(open(os.path.join(out_dir, f), encoding="utf-8"))


def repeat_drops(st: dict) -> list:
    """반복 클리어로 얻는 드롭 [아이템, 개수, 확률%] (확률 없는 것·1회 한정 첫 보상은 뺀다)."""
    d = st.get("drop") or []
    if st.get("dropOnce"):
        first, d = d[0][2] or 0, d[1:]
        # 1회 한정 보상이 확률로 나오는 경우(민달팽이 고양이 3% 등), 그걸 얻은 뒤엔 나머지가 100%를 나눠 갖는다
        rest = sum(x[2] or 0 for x in d)
        if 0 < first < 100 and abs(first + rest - 100) < 0.5:
            d = [[i, n, p * 100 / rest] for i, n, p in d]
    return [x for x in d if x[2]]


def stage_xp(st: dict) -> int:
    """한 번 클리어할 때 XP 기대값: 클리어 경험치(보물·아이템 보너스 전) + XP 드롭."""
    return round((st.get("xp") or 0) + sum(n * p / 100 for i, n, p in repeat_drops(st) if i == XP_DROP))


def ex_info(D: str, code: str, mid: int, si: int) -> tuple[int, int, list] | None:
    """스테이지를 깬 뒤 나올 수 있는 EX 스테이지: (출현 확률 %, EX 맵 번호, [(EX 스테이지 번호, 보상 dict)…]).

    stage<코드><맵>_<스테이지>.csv 첫 줄 = 성 번호, 이어하기 불가, EX 확률, EX 맵(엑스트라 RE 번호), EX 스테이지 처음, 끝
    (팩맨 콜라보: 1·2·3·4·5·7·10%, EX 맵 81 = 보너스 스테이지, 파워 쿠키 10개 확정).
    나무위키는 팩맨 EX를 "각 10% 확률로 등장"이라고 적어서, 사이트에서 확률을 바꿀 수 있게 한다.
    """
    cat = next((c for c in CATEGORIES if c[0] == code), None)
    if not cat:
        return None
    path = os.path.join(D, f"stage{cat[3]}{mid - cat[2] * 1000:03d}_{si:02d}.csv")
    if not os.path.exists(path):
        return None
    head = ints(read(path)[0])
    if len(head) < 6 or head[2] <= 0 or head[3] <= 0:
        return None
    msd = os.path.join(D, f"MapStageDataRE_{head[3]:03d}.csv")
    if not os.path.exists(msd):
        return None
    rows = [ints(l) for l in data_lines(msd)[2:]]
    ex = [(i, parse_reward(rows[i])) for i in range(head[4], head[5] + 1) if i < len(rows) and len(rows[i]) >= 6]
    return (head[2], head[3], ex) if ex else None


def ex_value(D: str, code: str, mid: int, si: int, items, depth: int = 0) -> tuple[int, dict, float] | None:
    """EX 한 번에 얻는 아이템·XP 기대값. EX 스테이지에서 또 EX가 나오면(악천후 예보: 호우 → 뇌우 → 대형 폭풍우, 각 100%)
    그 기대값도 데이터 확률대로 더한다. 반환: (첫 EX 출현 확률 %, {아이템: 개수}, XP)."""
    info = ex_info(D, code, mid, si)
    if not info or depth > 5:
        return None
    prob, exmap, exs = info
    got, xp = collections.Counter(), 0.0
    for j, e in exs:
        for item, n, p in repeat_drops(e) or [[d[0], d[1], 100] for d in e.get("drop", []) if e.get("dropAll")]:
            if str(item) in items:
                got[str(item)] += n * p / 100 / len(exs)
        xp += stage_xp(e) / len(exs)
        nested = ex_value(D, "RE", 4000 + exmap, j, items, depth + 1)
        if nested:
            np_, nt, nxp = nested
            for k, v in nt.items():
                got[k] += np_ / 100 * v / len(exs)
            xp += np_ / 100 * nxp / len(exs)
    return prob, got, xp


def ticket_gacha(D: str, maps: dict) -> tuple[dict, list, list]:
    """전용 티켓으로 돌리는 뽑기(럭키 뽑기·이벤트 뽑기)의 구성과, 그 티켓을 반복해서 얻는 스테이지.

    뽑기 세트 = GatyaData_Option_Set{N,E}.tsv 줄 (ItemID_Ticket = 스테이지 드롭 아이템 번호와 같음).
    캐릭 = GatyaDataSet{N,E}1.csv, 아이템 = GatyaDataSet{N,E}3.csv (같은 번호가 여러 번 = 그만큼 잘 나옴).
    등급 = 아이템은 Gatyaitembuy 0열 Rarity → 서버 확률 [노멀, 레어, 슈레, 울슈레, 레전드] 순서.
    캐릭은 럭키 뽑기(N)면 unitbuy 13열 레어도 (74/21/5%와 나무위키 표의 칸별 확률 3.7%·7%·5%가 일치),
    이벤트 뽑기(E)면 4번째 칸 = "한정 캐릭터" 등급 (나무위키 설날 뽑기 표, 이벤트 뽑기 아이템 중 Rarity 3이 하나도 없음).
    확률은 서버 이벤트 데이터(일정)에만 있어서 사이트가 일정 데이터에서 세트 번호로 찾는다.
    특별 아이템(EventGatyaMedamaItem.json, 30회마다 확정·개수 제한)은 따로 적어 둔다.
    """
    def rows(name):
        return [[int(x) for x in l.split(",") if x.strip() and int(x) >= 0] for l in read(os.path.join(D, name))]

    ub = [l.split(",") for l in read(os.path.join(D, "unitbuy.csv"))]
    item_rarity = [int(l.split(",")[0]) for l in read(os.path.join(D, "Gatyaitembuy.csv"))[1:] if l.strip()]
    medama = json.load(open(os.path.join(D, "EventGatyaMedamaItem.json"), encoding="utf-8"))["GatyaID"]
    gi = [l.split(",") for l in read(os.path.join(D, "Gatyaitembuy.csv"))[1:] if l.strip()]
    XP_ITEMS = {i for i, r in enumerate(gi) if r[8].strip() == "6"}  # srcItemID 6 = XP
    names = json.load(open(os.path.join(SITE, "data", "stages", "index.json"), encoding="utf-8"))["items"]

    gacha = {}  # 티켓 아이템 → {name, sets: {"kind:세트": {...}}}
    for kind, letter in (("normal", "N"), ("collab", "E")):
        chars, items = rows(f"GatyaDataSet{letter}1.csv"), rows(f"GatyaDataSet{letter}3.csv")
        opt = read(os.path.join(D, f"GatyaData_Option_Set{letter}.tsv"))[1:]
        for line in opt:
            r = line.split("\t")
            sid, ticket = int(r[0]), int(r[2])
            # 냥코 티켓·레어 티켓·통조림 뽑기는 따로 계산한다. 드롭 스테이지가 없는 티켓(옛 이벤트)도 뺀다
            if ticket in (CAT_TICKET, RARE_TICKET) or not names.get(str(ticket)):
                continue
            entries = []  # [등급, 칸 수, 캐릭 번호 or -1, 아이템 번호 or -1, 중복 NP]
            for cid, n in collections.Counter(chars[sid] if sid < len(chars) else []).items():
                grade = int(ub[cid][13]) if kind == "normal" else LIMITED
                entries.append([grade, n, cid, -1, int(ub[cid][58])])
            for iid, n in collections.Counter(items[sid] if sid < len(items) else []).items():
                entries.append([item_rarity[iid], n, -1, iid, 0])
            if not entries:
                continue
            g = gacha.setdefault(str(ticket), {"name": names[str(ticket)], "sets": {}})
            g["sets"][f"{kind}:{sid}"] = {
                "entries": entries,
                "special": [[d["id"], d["value"], names.get(str(d["id"])) or ("XP" if d["id"] in XP_ITEMS else f"아이템 {d['id']}")]
                            for d in medama.get(str(sid), {}).get("data", [])]
                if kind == "collab" else [],
            }

    stages, bets = [], []
    for mid, (code, m) in sorted(maps.items()):
        if code == "B" or mid in SKIP_MAPS:
            continue
        for st in m["stages"]:
            got, top = collections.Counter(), {}
            for item, n, p in repeat_drops(st):
                if str(item) in gacha:
                    got[str(item)] += n * p / 100
                    top[str(item)] = max(top.get(str(item), 0), n)  # 트레저 레이더를 쓰면 이만큼 확정
            # EX 스테이지 (통솔력 0): EX 한 번에 얻는 티켓·XP 기대값 (EX 스테이지가 여럿이면 평균)
            ex, exr = None, ex_value(D, code, mid, st["i"], gacha)
            if exr and exr[1]:
                ex = {"p": exr[0], "t": {k: round(v, 3) for k, v in exr[1].items()}, "xp": round(exr[2])}
            e = st.get("energy") or 0
            if e >= ITEM_COST:
                # 티켓을 걸고 들어가는 스테이지 (한탕 오락실): 통솔력이 안 들어서 순위 대신 "n개 걸면 평균 m개"로 보여 준다
                if got:
                    bets.append({"map": mid, "i": st["i"], "name": m["n"], "stage": st["n"], "item": e // 1000, "cost": e % 1000,
                                 "t": {k: round(v, 3) for k, v in got.items()}})
            elif got or ex:
                stages.append({"map": mid, "i": st["i"], "name": m["n"], "stage": st["n"], "energy": st.get("energy"), "xp": stage_xp(st),
                               "t": {k: round(v, 3) for k, v in got.items()}, **({"ex": ex} if ex else {}),
                               **({"top": top} if any(top[k] > got[k] + 1e-6 for k in top) else {})})
    return gacha, stages, bets


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--version", default="15.6.0")
    args = ap.parse_args(argv)
    G, _ = game_data_dir(args.version)
    D = os.path.join(G, "DataLocal")

    # 중복 NP: 레어도마다 가장 흔한 값 (기본·EX·레어·슈레·울슈레·레전드)
    by = collections.defaultdict(collections.Counter)
    for l in read(os.path.join(D, "unitbuy.csv")):
        r = l.split(",")
        if len(r) > 58 and r[13].strip().isdigit() and r[58].strip().isdigit():
            by[int(r[13])][int(r[58])] += 1
    dupe = [by[i].most_common(1)[0][0] for i in range(6)]

    grade_np = [int(l.split(",")[1]) for l in read(os.path.join(D, "equipmentgrade.csv"))
                if l.strip() and not l.startswith("//")]
    orbs = json.load(open(os.path.join(D, "equipmentlist.json"), encoding="utf-8"))["ID"]

    def orb_np(drop: list) -> tuple[float, list[float]]:
        """한 번 클리어할 때 본능옥 NP 기대값과 등급별 확률(%)."""
        ev, grades = 0.0, [0.0] * len(grade_np)
        for item, n, p in drop:
            if item >= ORB and item - ORB < len(orbs):
                g = orbs[item - ORB]["gradeID"]
                ev += p / 100 * n * grade_np[g]
                grades[g] += p
        return round(ev, 4), [round(x, 2) for x in grades]

    out_dir = os.path.join(SITE, "data", "stages")
    stages = dict(stage_files(out_dir))
    maps = {int(mid): (code, m) for code, ms in stages.items() for mid, m in ms.items()}

    # 본능옥 스테이지 (지도·EX)
    orb_maps, ex_tier = [], {}
    for mid, (code, m) in sorted(maps.items()):
        for st in m["stages"]:
            ev, grades = orb_np(repeat_drops(st))
            if not ev:
                continue
            if mid in EX_MAPS:
                tier = next(i for i, w in enumerate(("기원", "정점", "비경")) if w in m["n"])
                ex_tier.setdefault(tier, set()).add(ev)
            else:
                orb_maps.append({"map": mid, "i": st["i"], "name": m["n"], "stage": st["n"], "energy": st.get("energy"), "xp": stage_xp(st),
                                 "np": ev, "grades": grades})
    # EX 스테이지 NP는 속성과 상관없이 단계마다 같다 (다르면 빌드를 멈춘다)
    assert all(len(v) == 1 for v in ex_tier.values()), ex_tier
    ex_np = [ex_tier[i].pop() for i in range(3)]

    # 강습 스테이지별 EX 확률 [기원, 정점, 비경] (%)
    behemoth = {}
    for l in read(os.path.join(D, "EX_group.csv")):
        r = [int(x) for x in l.split("//")[0].split(",") if x.strip().lstrip("-").isdigit()]
        if len(r) < 5 or r[1] not in maps or maps[r[1]][0] != "A":
            continue
        mid, si, pairs = r[1], r[2], list(zip(r[3::2], r[4::2]))
        if mid not in behemoth:
            behemoth[mid] = {"exIds": set(), "stages": {}}
        rest, probs = 100.0, {}
        for ex, p in pairs:
            probs[ex] = rest * p / 100
            rest -= probs[ex]
            behemoth[mid]["exIds"].add(ex)
        behemoth[mid]["stages"][si] = probs
    beh_out = []
    for mid, b in sorted(behemoth.items()):
        ids = sorted(b["exIds"])  # 작은 번호부터 기원 · 정점 · 비경
        if len(ids) != 3:
            continue
        m = maps[mid][1]
        rows = []
        for st in m["stages"]:
            pr = b["stages"].get(st["i"])
            if pr:
                rows.append({"i": st["i"], "name": st["n"], "energy": st.get("energy"), "xp": stage_xp(st),
                             "ex": [round(pr.get(x, 0), 2) for x in ids]})
        beh_out.append({"map": mid, "name": m["n"], "stages": rows})

    # 냥코 티켓·레어 티켓을 반복해서 얻는 스테이지 (고양이 드링크 스테이지 B는 통솔력이 아니라서 뺀다)
    tickets = []
    for mid, (code, m) in sorted(maps.items()):
        if code == "B" or mid in SKIP_MAPS:
            continue
        for st in m["stages"]:
            # 열릴 때마다 새로 깰 수 있는 1회 보상 스테이지 (메타쿠마): 첫 보상도 센다
            d = [x for x in st.get("drop") or [] if x[2]] if mid in OPEN_ONCE else repeat_drops(st)
            cat = sum(n * p / 100 for item, n, p in d if item == CAT_TICKET)
            rare = sum(n * p / 100 for item, n, p in d if item == RARE_TICKET)
            if cat or rare:
                tickets.append({"map": mid, "i": st["i"], "name": m["n"], "stage": st["n"], "energy": st.get("energy"), "xp": stage_xp(st),
                                "cat": round(cat, 3), "rare": round(rare, 3),
                                # 트레저 레이더를 쓰면 확정되는 개수 (드롭이 확률일 때만 의미 있음)
                                "catTop": max([n for item, n, p in d if item == CAT_TICKET] or [0]),
                                "rareTop": max([n for item, n, p in d if item == RARE_TICKET] or [0])})

    gacha, gacha_stages, bets = ticket_gacha(D, maps)

    # XP 스테이지: 통솔력당 XP가 좋은 맵 (고양이 드링크 스테이지 B는 통솔력이 아니라서 뺀다)
    # Map_option.csv "XP2倍広告" 열 = 광고를 보면 클리어 XP가 2배인 맵 (게릴라 경험치다냥·토일 스테이지). 드롭 XP는 그대로
    mo = read(os.path.join(D, "Map_option.csv"))
    col = mo[0].split(",").index("XP2倍広告")
    ad_maps = {int(r[0]) for r in (l.split(",") for l in mo[1:]) if len(r) > col and r[0].isdigit() and r[col].strip() == "1"}
    by_map = collections.defaultdict(list)
    for mid, (code, m) in maps.items():
        if code == "B" or mid in SKIP_MAPS:
            continue
        for st in m["stages"]:
            xp, e = stage_xp(st), st.get("energy") or 0
            if xp and e > 0:
                ad = mid in ad_maps
                by_map[mid].append({"map": mid, "i": st["i"], "name": m["n"], "stage": st["n"], "energy": e, "xp": xp,
                                    **({"ad": st.get("xp") or 0} if ad else {})})
    best = sorted(by_map, key=lambda k: -max((x["xp"] + x.get("ad", 0)) / x["energy"] for x in by_map[k]))
    # 같은 이름으로 다시 열린 맵(복각)은 하나만
    xp_stages, seen = [], set()
    for mid in best:
        if by_map[mid][0]["name"] in seen:
            continue
        seen.add(by_map[mid][0]["name"])
        xp_stages += by_map[mid]
        if len(seen) >= XP_MAPS:
            break
    # 뽑기에서 나오는 XP 아이템 (Gatyaitembuy srcItemID 6, quantity = XP 양)
    gi = [l.split(",") for l in read(os.path.join(D, "Gatyaitembuy.csv"))[1:] if l.strip()]
    xp_items = {str(i): int(r[4]) for i, r in enumerate(gi) if r[8].strip() == "6"}

    drink = None
    rows = read(os.path.join(D, "itemShopData.tsv"))
    head = rows[0].split("\t")
    for line in rows[1:]:
        r = dict(zip(head, line.split("\t")))
        if r.get("gatyaItemID") == str(DRINK_A):
            drink = int(r["ItemPrice"]) / int(r["ItemValue"])

    data = {"dupe": dupe, "gradeNp": grade_np, "exNp": ex_np, "drinkA": drink,
            "behemoth": beh_out, "orbMaps": orb_maps, "tickets": tickets,
            "gacha": gacha, "gachaStages": gacha_stages, "bets": bets, "xpStages": xp_stages, "xpItems": xp_items}
    out = os.path.join(SITE, "data", "np.json")
    with open(out, "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{out}: 중복 NP {dupe}, 본능옥 NP {grade_np}, EX {ex_np}, 강습 {len(beh_out)}개, "
          f"본능옥 스테이지 {len(orb_maps)}개, 티켓 스테이지 {len(tickets)}개, 드링크 A {drink}통조림, "
          f"티켓 뽑기 {len(gacha)}종, 티켓 뽑기 스테이지 {len(gacha_stages)}개, XP 맵 {len(seen)}개")


if __name__ == "__main__":
    main()
