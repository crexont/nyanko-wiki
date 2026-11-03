"""스테이지 데이터를 사이트용으로 빌드한다 (개발용, build_enemies.py 다음에 실행).

- 맵 이름: resLocal/Map_Name.csv (번호 = 분류 코드 × 1000 + 맵 번호), 스테이지 이름: StageName_<코드>_ko.csv
- 스테이지: stage<코드><맵>_<스테이지>.csv (적 배치), MapStageData<코드>_<맵>.csv (통솔력·경험치·드롭),
  Map_option.csv (별 난이도 배율)
- 읽는 방식: BCU(오픈소스 시뮬레이터) util/stage/Stage.java, info/DefStageInfo.java (slow_kotlin 브랜치)
- 일본어 이름(한국판 미출시)인 맵·스테이지는 뺀다.

출력: docs/data/stages/index.json (분류·맵 목록), docs/data/stages/<코드>.json (분류별 스테이지),
      docs/icons/items/<아이템 ID>.png (드롭 아이템 아이콘 추가)
사용: python tools/build_stages.py [--version 15.6.0]
"""
from __future__ import annotations

import argparse
import json
import os
import re

from build_gamedata import DEFAULT_FILES, SITE, IconPacks, game_data_dir, read

# (사이트 코드, 분류 이름, 맵 번호 앞자리, 스테이지 파일 코드, 이름 파일 코드, MapStageData 코드)
CATEGORIES = [
    ("N", "레전드 스토리", 0, "RN", "RN", "N"),
    ("NA", "신 레전드 스토리", 13, "RNA", "RNA", "NA"),
    ("ND", "제로 레전드", 34, "RND", "RND", "ND"),
    ("S", "이벤트 스테이지", 1, "RS", "RS", "S"),
    ("C", "콜라보 스테이지", 2, "RC", "RC", "C"),
    ("A", "강습 스테이지", 24, "RA", "RA", "A"),
    ("CA", "콜라보 강습", 27, "RCA", "RCA", "CA"),
    ("H", "고전장", 25, "RH", "RH", "H"),
    ("Q", "토벌 스테이지", 31, "RQ", "RQ", "Q"),
    ("RE", "엑스트라 스테이지", 4, "EX", "RE", "RE"),
    ("B", "개다래 스테이지", 14, "RB", "RB", "B"),
    ("V", "풍운 냥코탑", 7, "RV", "RV", "V"),
    ("SR", "이차원 콜로세움", 36, "RSR", "RSR", "SR"),
    ("G", "냥코도 승단 시험", 37, "G", "G", "G"),
    ("DM", "마계편", 30, "DM", "DM", "DM"),
    ("L", "미궁", 33, "L", "L", "L"),
    ("T", "냥코 도장", 6, "RT", "RT", "T"),
    ("R", "랭킹의 방", 11, "RR", "RR", "R"),
    ("M", "챌린지 배틀", 12, "RM", "RM", "M"),
]
# 일본어(가나·한자)가 남은 이름 = 한국판 미출시. "(旧)"는 한국판 이름에도 붙어서 먼저 바꾼다
# 분류 파일이 아닌 출력 (역색인·목록)
SKIP_FILES = ("index.json", "enemy_stages.json", "cat_drops.json", "item_drops.json", "stage_names.json")
KANA = re.compile(r"[ぁ-ゖァ-ヺ一-鿿]")
OLD = "(旧)"


def ints(line: str) -> list[int]:
    out = []
    for x in line.split("//")[0].split(","):
        x = x.strip()
        if x.lstrip("-").isdigit():
            out.append(int(x))
        elif x:
            break
    return out


def data_lines(path: str) -> list[str]:
    """주석·빈 줄을 뺀 줄 (MapStageData)."""
    return [l for l in read(path) if l.split("//")[0].strip()]


def parse_stage(path: str, castle_row: bool = True) -> dict | None:
    """적 배치. BCU Stage(…, type 0): 성 줄 → 스테이지 정보 줄 → 적 줄들 ("0,"으로 시작하는 줄에서 끝)."""
    lines = [l for l in read(path) if l.strip()]
    if len(lines) < 2:
        return None
    head = ints(lines[0])
    i = 0
    st: dict = {}
    if castle_row:  # 성 정보 줄: 성 번호, 이어하기 불가, EX 확률, EX 맵, EX 스테이지 범위 (메인 스토리 외에는 항상 있다)
        if len(head) > 1 and head[1] == 1:
            st["nc"] = 1
        if len(head) > 5 and head[2]:
            st["ex"] = [head[2], head[3], head[4], head[5]]
        i = 1
    info = ints(lines[i])
    if len(info) < 7:
        return None
    st.update({"w": info[0], "hp": info[1], "max": min(50, info[5])})
    if len(info) >= 8 and info[7] > 0:
        st["time"] = info[7]  # 제한 시간(분) — 이 경우 성 체력은 무한
    if len(info) >= 9 and i == 1 and info[8] == 1:
        st["bg"] = 1  # 보스 가드
    base_enemy = info[6] - 2
    en = []
    for l in lines[i + 1:]:
        if not l[:1].isdigit() or l.startswith("0,"):
            break
        r = [x.strip() for x in l.split("//")[0].split(",")]
        d = [int(x) if x.lstrip("-").isdigit() else 0 for x in r]
        d += [0] * (14 - len(d))
        if len(r) < 10 or not r[9].strip():
            d[9] = 100
        eid, mag = d[0] - 2, d[9]
        base_pct = d[5]
        if "time" not in st and base_pct > 100 and mag == 100:  # 옛 형식: 5열이 배율
            mag, base_pct = base_pct, 100
        atk_mag = d[11] if len(r) > 11 and d[11] else mag
        first = d[2] * 2 * (-1 if len(r) > 12 and d[12] == 1 else 1)
        line = [eid, d[1], first, d[3] * 2, d[4] * 2, base_pct, d[8], mag, atk_mag, d[13]]
        if eid == base_enemy:
            line.append(1)  # 이 적이 성 역할
        en.append(line)
    st["en"] = en
    return st


def drop_chances(drop: list[list[int]], rand: int) -> list | None:
    """BCU DefStageInfo.analyzeRewardChance 와 같은 계산. None = 확률 없음, [] = 전부 획득."""
    total = sum(d[0] for d in drop)
    if total == 0:
        return None
    if total == 1000:
        return [round(d[0] / 10, 2) for d in drop]
    if (total == len(drop) and total != 1) or rand == -3:
        return []
    if total == 100:
        return [d[0] for d in drop]
    if total > 100 and rand in (0, 1):
        rest, out = 100.0, []
        items = drop
        if drop[0][0] == 100:
            out.append(100)
            items = drop[1:]
        for d in items:
            f = rest * d[0] / 100
            rest -= f
            out.append(round(f, 2))
        return out
    if rand == -4:
        return [round(d[0] * 100 / total, 2) for d in drop]
    return [d[0] for d in drop]


# 스테이지 보상의 11·12·13은 GatyaitemName 행(XP 10000 등)이 아니라 티켓·통조림.
# "냥코티켓★찬스!", "역습의 하마양"(냥코 티켓), 재회의 지도·강습 Lv.15(레어 티켓)로 확인. 13(통조림)은 개수(20·30·50)로 추정
REWARD_ALIAS = {11: 20, 12: 21, 13: 22}


def parse_reward(row: list[int]) -> dict:
    """MapStageData 한 줄: 통솔력, 경험치, … 드롭. BCU DefStageInfo 생성자와 같은 해석."""
    out = {"energy": row[0], "xp": row[1]}
    is_time = len(row) > 15 and all(x == -2 for x in row[8:15])
    if len(row) == 6:
        drop, rand = [], 0
    elif is_time or len(row) <= 9:
        drop, rand = [row[5:8]], 0
    else:
        rand = row[8]
        n = (len(row) - 7) // 3
        drop = [row[5:8]] + [row[6 + i * 3:9 + i * 3] for i in range(1, n)]
    drop = [d for d in drop if len(d) == 3 and d[1] >= 0 and d[2] > 0]
    if drop:
        ch = drop_chances(drop, rand)
        out["drop"] = [[REWARD_ALIAS.get(d[1], d[1]), d[2], (ch[k] if ch and k < len(ch) else None)] for k, d in enumerate(drop)]
        if ch == []:
            out["dropAll"] = 1
        if rand == 1:
            out["dropOnce"] = 1   # 첫 번째 보상은 1회 한정
    if is_time:
        out["timeDrop"] = [row[16 + i * 3:19 + i * 3] for i in range((len(row) - 17) // 3)]
    return out


# 메인 스토리: (맵 번호, 스테이지 파일 이름 틀, 보상 파일, 이름 파일, 성 정보 줄 여부, 적 배율 곱(%))
# BCU MapColc.DefMapColc() 와 같은 구성. 세계편 1~3장은 같은 스테이지를 장마다 100·150·400%로 쓴다.
MAIN = (
    [(3000 + c, "stage{s:02d}.csv", "stageNormal0.csv", "StageName0_ko.csv", False, (100, 150, 400)[c]) for c in range(3)]
    + [(3003 + c, f"stageW{4 + c:02d}_{{s:02d}}.csv", f"stageNormal1_{c}.csv", "StageName1_ko.csv", False, 100) for c in range(3)]
    + [(3006 + c, f"stageSpace{7 + c:02d}_{{s:02d}}.csv", f"stageNormal2_{c}.csv", "StageName2_ko.csv", False, 100) for c in range(3)]
)
ZOMBIE = (
    [(20000 + c, f"stageZ{c:02d}_{{s:02d}}.csv", f"stageNormal0_{c}_Z.csv", "StageName0_ko.csv", True, 100) for c in range(3)]
    + [(21000 + c, f"stageZ{4 + c:02d}_{{s:02d}}.csv", f"stageNormal1_{c}_Z.csv", "StageName1_ko.csv", True, 100) for c in range(3)]
    + [(22000 + c, f"stageZ{7 + c:02d}_{{s:02d}}.csv", f"stageNormal2_{c}_Z.csv", "StageName2_ko.csv", True, 100) for c in range(3)]
    + [(23000, "stageSpace09_Invasion_{s:02d}.csv", "stageNormal2_2_Invasion.csv", None, True, 100)]
)


def main_story_name(names: list[str], s: int) -> str:
    """메인 스토리 이름 파일은 거꾸로 적혀 있다 (tbcml Stage.convert_main_story_stage_id): 0~45 → 45−s, 46·47은 그대로."""
    row = s if s >= 46 else 45 - s
    return names[row].split("|")[0].strip() if row < len(names) else ""


def build_main(D: str, R: str, map_names: dict, specs: list) -> tuple[dict, list]:
    out, maps = {}, []
    for mid, pattern, reward_file, name_file, castle, mult in specs:
        names = read(os.path.join(R, name_file)) if name_file else []
        rp = os.path.join(D, reward_file)
        rewards = [ints(l) for l in data_lines(rp)[2:]] if os.path.exists(rp) else []
        stages = []
        for s in range(48):
            p = os.path.join(D, pattern.format(s=s))
            if not os.path.exists(p):
                break
            st = parse_stage(p, castle_row=castle)
            if not st:
                continue
            if mult != 100:
                for e in st["en"]:
                    e[7] = e[7] * mult // 100
                    e[8] = e[8] * mult // 100
            sname = main_story_name(names, s) if names else map_names.get(mid, "")
            st = {"i": s, "n": sname or f"{s + 1}스테이지", **st}
            if s < len(rewards) and len(rewards[s]) >= 6:
                st.update(parse_reward(rewards[s]))
            stages.append(st)
        if stages:
            name = map_names.get(mid, f"맵 {mid}")
            out[mid] = {"n": name, "stars": [100], "stages": stages}
            maps.append([mid, name, len(stages)])
    return out, maps


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--files", default=DEFAULT_FILES)
    ap.add_argument("--version", default="15.6.0")
    args = ap.parse_args(argv)

    G, _ = game_data_dir(args.version)
    D, R = os.path.join(G, "DataLocal"), os.path.join(G, "resLocal")
    map_names = {}
    for l in read(os.path.join(R, "Map_Name.csv")):
        if "|" in l:
            k, v = l.split("|", 1)
            if k.strip().isdigit():
                map_names[int(k)] = v.split("|")[0].strip()
    stars = {}
    for l in read(os.path.join(D, "Map_option.csv"))[1:]:
        r = l.split(",")
        if len(r) > 6 and r[0].isdigit():
            n = max(1, int(r[1]))
            stars[int(r[0])] = [int(x) for x in r[3:3 + min(n, 4)]]
    item_names = [l.split("|")[0].strip() for l in read(os.path.join(R, "GatyaitemName.csv"))]

    out_dir = os.path.join(SITE, "data", "stages")
    os.makedirs(out_dir, exist_ok=True)
    index, used_enemies, used_items = [], set(), set()
    n_maps = n_stages = 0
    for code, title, specs in (("MS", "메인 스토리", MAIN), ("Z", "좀비 습격", ZOMBIE)):
        cat_out, maps = build_main(D, R, map_names, specs)
        for m in cat_out.values():
            for st in m["stages"]:
                used_enemies.update(e[0] for e in st["en"])
                used_items.update(d[0] for d in st.get("drop", []) if d[0] < 1000)
            n_stages += len(m["stages"])
        n_maps += len(maps)
        with open(os.path.join(out_dir, f"{code}.json"), "w", encoding="utf-8") as f:
            json.dump(cat_out, f, ensure_ascii=False, separators=(",", ":"))
        index.append({"code": code, "name": title, "maps": maps})
    for code, title, prefix, scode, ncode, mcode in CATEGORIES:
        name_path = os.path.join(R, f"StageName_{ncode}_ko.csv")
        stage_names = [l.split("|") for l in read(name_path)] if os.path.exists(name_path) else []
        maps, cat_out = [], {}
        for m in range(1000):
            msd = os.path.join(D, f"MapStageData{mcode}_{m:03d}.csv")
            first = os.path.join(D, f"stage{scode}{m:03d}_00.csv")
            if not os.path.exists(msd) and not os.path.exists(first):
                if m > 5 and not os.path.exists(os.path.join(D, f"stage{scode}{m + 1:03d}_00.csv")):
                    break
                continue
            mid = prefix * 1000 + m
            mname = map_names.get(mid, "").replace(OLD, "(옛 버전)")
            if not mname or KANA.search(mname):
                continue  # 한국판에 없는 맵
            rewards = [ints(l) for l in data_lines(msd)[2:]] if os.path.exists(msd) else []
            names = stage_names[m] if m < len(stage_names) else []
            stages = []
            for s in range(100):
                p = os.path.join(D, f"stage{scode}{m:03d}_{s:02d}.csv")
                if not os.path.exists(p):
                    break
                sname = names[s].strip().replace(OLD, "(옛 버전)") if s < len(names) else ""
                if sname == "＠":
                    break
                st = parse_stage(p)
                if not st or KANA.search(sname):
                    continue
                st = {"i": s, "n": sname or f"{s + 1}스테이지", **st}
                if s < len(rewards) and len(rewards[s]) >= 6:
                    st.update(parse_reward(rewards[s]))
                used_enemies.update(e[0] for e in st["en"])
                used_items.update(d[0] for d in st.get("drop", []) if d[0] < 1000)
                stages.append(st)
            if not stages:
                continue
            cat_out[mid] = {"n": mname, "stars": stars.get(mid, [100]), "stages": stages}
            maps.append([mid, mname, len(stages)])
            n_maps += 1
            n_stages += len(stages)
        if not maps:
            continue
        with open(os.path.join(out_dir, f"{code}.json"), "w", encoding="utf-8") as f:
            json.dump(cat_out, f, ensure_ascii=False, separators=(",", ":"))
        index.append({"code": code, "name": title, "maps": maps})

    # 스테이지 이름 검색용: {맵 번호: [[스테이지 번호, 이름], ...]} (스테이지 목록 페이지에서 검색할 때만 받는다)
    names_out: dict[int, list] = {}
    for f in os.listdir(out_dir):
        if f.endswith(".json") and f not in SKIP_FILES:
            for mid, m in json.load(open(os.path.join(out_dir, f), encoding="utf-8")).items():
                names_out[int(mid)] = [[st["i"], st["n"]] for st in m["stages"]]
    with open(os.path.join(out_dir, "stage_names.json"), "w", encoding="utf-8") as f:
        json.dump(names_out, f, ensure_ascii=False, separators=(",", ":"))

    # 적 → 등장 스테이지 (적 상세 페이지용): {적 ID: [[맵 번호, [스테이지 번호, ...]], ...]}
    appear: dict[int, dict[int, list[int]]] = {}
    for f in os.listdir(out_dir):
        if f.endswith(".json") and f not in SKIP_FILES:
            for mid, m in json.load(open(os.path.join(out_dir, f), encoding="utf-8")).items():
                for st in m["stages"]:
                    for e in st["en"]:
                        lst = appear.setdefault(e[0], {}).setdefault(int(mid), [])
                        if st["i"] not in lst:
                            lst.append(st["i"])
    with open(os.path.join(out_dir, "enemy_stages.json"), "w", encoding="utf-8") as f:
        json.dump({eid: sorted(maps.items()) for eid, maps in appear.items()}, f, separators=(",", ":"))

    # 드롭 보상 번호 1000 이상 = 캐릭 (drop_chara.csv: 드롭 번호 → 캐릭 ID). 캐릭 → 드롭 스테이지 목록도 만든다
    drop_chara = {}
    for l in read(os.path.join(D, "drop_chara.csv"))[1:]:
        r = [x.strip() for x in l.split(",")]
        if len(r) >= 3 and r[0].lstrip("-").isdigit() and int(r[0]) >= 0:
            drop_chara[int(r[0])] = int(r[2])
    cat_drops: dict[int, list] = {}
    for f in os.listdir(out_dir):
        if f.endswith(".json") and f not in SKIP_FILES:
            for mid, m in json.load(open(os.path.join(out_dir, f), encoding="utf-8")).items():
                for st in m["stages"]:
                    for d in st.get("drop", []):
                        if d[0] >= 1000 and d[0] in drop_chara:
                            cat_drops.setdefault(drop_chara[d[0]], []).append([int(mid), st["i"], d[2], st.get("dropAll", 0), st["n"]])
    with open(os.path.join(out_dir, "cat_drops.json"), "w", encoding="utf-8") as f:
        json.dump({k: sorted(v) for k, v in cat_drops.items()}, f, separators=(",", ":"))

    # 아이템(번호 < 1000) → 드롭 스테이지 (육성 페이지 "재료 드롭 스테이지"용):
    # {아이템: [[맵, 스테이지, 확률(%)|null, 전부 획득, 스테이지 이름, 통솔력], ...]}
    item_drops: dict[int, list] = {}
    for f in os.listdir(out_dir):
        if f.endswith(".json") and f not in SKIP_FILES:
            for mid, m in json.load(open(os.path.join(out_dir, f), encoding="utf-8")).items():
                for st in m["stages"]:
                    for d in st.get("drop", []):
                        if 0 <= d[0] < 1000:
                            item_drops.setdefault(d[0], []).append(
                                [int(mid), st["i"], d[2], st.get("dropAll", 0), st["n"], st.get("energy")])
    with open(os.path.join(out_dir, "item_drops.json"), "w", encoding="utf-8") as f:
        json.dump(item_drops, f, ensure_ascii=False, separators=(",", ":"))

    items = {i: item_names[i] for i in sorted(used_items) if i < len(item_names)}
    with open(os.path.join(out_dir, "index.json"), "w", encoding="utf-8") as f:
        json.dump({"categories": index, "items": items, "chara": drop_chara}, f, ensure_ascii=False, separators=(",", ":"))

    # 드롭 아이템 아이콘 (build_gamedata 가 만든 docs/icons/items 에 없는 것만 추가)
    packs = IconPacks(args.files)
    item_dir = os.path.join(SITE, "icons", "items")
    added = 0
    for i in sorted(used_items):
        dst = os.path.join(item_dir, f"{i}.png")
        if not os.path.exists(dst):
            png = packs.get(f"gatyaitemD_{i:02d}_f.png")
            if png:
                with open(dst, "wb") as fp:
                    fp.write(png)
                added += 1

    with open(os.path.join(SITE, "data", "enemies.json"), encoding="utf-8") as f:
        known = {e["id"] for e in json.load(f)}
    missing = sorted(used_enemies - known)
    print(f"분류 {len(index)}개, 맵 {n_maps}개, 스테이지 {n_stages}개, 드롭 아이템 아이콘 {added}개 추가")
    print(f"스테이지에 나오지만 적 목록에 없는 적 {len(missing)}종: {missing[:40]}")


if __name__ == "__main__":
    main()
