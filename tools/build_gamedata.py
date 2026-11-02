"""게임 데이터(이름·레어도·본능·속성) + 아이콘을 앱용으로 빌드한다.

- CSV: BCSFE가 내려받은 한국판 게임 데이터 (없으면 자동 다운로드)
- 아이콘: 기기에서 꺼낸 APK의 UnitLocal.pack + *UnitServer.pack 을 복호화해서 uni###_?00.png 추출 (알 캐릭은 uniNNN_m0?)

- 아이템 아이콘: ImageLocal.pack(APK) + *ImageServer.pack 의 gatyaitemD_<아이템 ID>_f.png

출력: docs/gamedata.js (window.GAMEDATA), docs/icons/<id>_<form>.png, docs/icons/items/<아이템 ID>.png  (GitHub Pages 사이트용, 커밋한다)
사용: python tools/extract_vhdx.py --with-packs → python tools/build_gamedata.py [--version 15.6.0]
      → build_enemies.py → build_stages.py (docs/icons 를 새로 만들어서 적·드롭 아이콘도 다시 뽑아야 한다)
"""
from __future__ import annotations

import argparse
import glob
import hashlib
import json
import os
import re
import shutil

from Crypto.Cipher import AES

from common import ROOT, use_local_bcsfe_dir

DEFAULT_FILES = os.path.join(ROOT, "device")
SITE = os.path.join(ROOT, "docs")

RARITY = ["기본", "EX", "레어", "슈퍼레어", "울트라슈퍼레어", "레전드레어"]
# 미출시 자리표시 이름: "730_1" 같은 번호, 또는 번역 안 된 일본어(가나 글자).
# 한국판 이름에도 쓰이는 가운뎃점 ・(U+30FB)·장음 ー(U+30FC)는 가나로 치지 않는다.
DUMMY_NAME = re.compile(r"\d+[_-]\d+|.*[ぁ-ゖァ-ヺ].*")
# unitNNN.csv 의 타겟 속성 컬럼
TRAIT_COLS = {10: "빨강", 16: "떠있음", 17: "검정", 18: "메탈", 19: "무속성",
              20: "천사", 21: "에이리언", 22: "좀비", 78: "고대종", 96: "악마"}
# 본능 설명 "유효 타겟에 X를 추가" 의 X → 속성
TALENT_TRAIT = {"빨간 적": "빨강", "떠있는 적": "떠있음", "검은 적": "검정",
                "메탈 적": "메탈", "천사": "천사", "에이리언": "에이리언",
                "좀비": "좀비", "고대종": "고대종", "속성을 가지지 않는 적": "무속성",
                "악마": "악마"}
STAT_TALENT = {"체력 저하로 공격력": "공격력 업(체력 저하)", "기본 체력": "기본 체력 UP",
               "기본 공격력": "기본 공격력 UP", "이동 속도": "이동 속도 UP",
               "넉백 횟수": "넉백 횟수 UP", "생산 코스트": "생산 코스트 다운",
               "생산 스피드": "생산 스피드 UP", "공격 간격": "공격 간격 단축"}


def game_data_dir(version: str) -> tuple[str, str]:
    """(CSV 폴더, 실제로 받은 버전). 정확한 버전이 없으면 BCSFE가 가까운 버전을 고른다."""
    from bcsfe import core
    use_local_bcsfe_dir()
    core.core_data.init_data()
    gdg = core.GameDataGetter(core.CountryCode.from_code("kr"),
                              core.GameVersion.from_string(version))
    if gdg.download("DataLocal", "unitbuy.csv") is None:
        raise SystemExit("게임 데이터 다운로드 실패")
    return str(gdg.get_version_path()), str(gdg.version)


def read(path: str) -> list[str]:
    with open(path, encoding="utf-8") as f:
        return f.read().splitlines()


def talent_name(desc: str) -> str:
    m = re.search(r"「([^」]+)」", desc)
    if m:
        return m[1].strip() + (" 강화" if "강화합니다" in desc.split("<br>")[0] else "")
    m = re.search(r"유효 타겟에 (.+?)(?:을|를) 추가", desc)
    if m:
        return f"타겟 추가: {m[1]}"
    for key, name in STAT_TALENT.items():
        if key in desc.split("<br>")[0]:
            return name
    return desc.split("<br>")[0]


def talent_trait(desc: str) -> str | None:
    m = re.search(r"유효 타겟에 (.+?)(?:을|를) 추가", desc)
    return TALENT_TRAIT.get(m[1]) if m else None


LIST_KEY = hashlib.md5(b"pack").hexdigest()[:16].encode()
SERVER_KEY = hashlib.md5(b"battlecats").hexdigest()[:16].encode()      # *Server.pack (다운로드 팩)
LOCAL_KEY = bytes.fromhex("bea585eb993216ef4dcb88b625c3df98")          # APK 안 *Local.pack (한국판)
LOCAL_IV = bytes.fromhex("9b13c2121d39f1353a125fed98696649")


UNIT_ANIM = re.compile(r"\d{3}_[fcsu]02\.maanim")  # 캐릭 공격 모션 (02 = 공격)
ITEM_ICON = re.compile(r"gatyaitemD_\d+_f\.png")  # 아이템 아이콘 (번호 = GatyaitemName 행 = 아이템 ID)
ENEMY_FILE = re.compile(r"enemy_icon_\d{3}\.png|\d{3}_e02\.maanim")  # 적 아이콘·공격 모션 (build_enemies.py)
# 재화 아이콘: 경험치·NP·통조림·냥코/레어/플래티넘/레전드 티켓
CURRENCY_ITEMS = {"xp": 6, "np": 7, "catfood": 22, "normalTickets": 20, "rareTickets": 21,
                  "platinumTickets": 29, "legendTickets": 145}


class IconPacks:
    """기기에서 꺼낸 팩 묶음 (아이콘·공격 모션). APK의 *Local(기본 리소스) 위에 *Server(업데이트)를 덮어쓴다."""

    def __init__(self, files_dir: str):
        self.index: dict[str, tuple[str, int, int]] = {}
        self._cache: dict[str, bytes] = {}
        lists = sorted(glob.glob(os.path.join(files_dir, "*Local.list"))) + \
            sorted(glob.glob(os.path.join(files_dir, "*Server.list")))
        for lst in lists:
            raw = AES.new(LIST_KEY, AES.MODE_ECB).decrypt(open(lst, "rb").read())
            for line in raw[:-raw[-1]].decode("utf-8", "replace").splitlines()[1:]:
                name, off, size = line.split(",")[:3]
                if name.startswith("uni") or UNIT_ANIM.fullmatch(name) or ITEM_ICON.fullmatch(name) or ENEMY_FILE.fullmatch(name):
                    self.index[name] = (lst[:-5] + ".pack", int(off), int(size))

    def get(self, name: str, text: bool = False) -> bytes | None:
        if name not in self.index:
            return None
        pack, off, size = self.index[name]
        if pack not in self._cache:
            self._cache[pack] = open(pack, "rb").read()
        seg = self._cache[pack][off:off + size]
        seg = seg[:len(seg) // 16 * 16]
        if os.path.basename(pack).startswith("ImageDataLocal"):
            data = self._cache[pack][off:off + size]  # APK의 ImageDataLocal 은 암호화돼 있지 않다
        elif "Server" in os.path.basename(pack):
            data = AES.new(SERVER_KEY, AES.MODE_ECB).decrypt(seg)
        else:
            data = AES.new(LOCAL_KEY, AES.MODE_CBC, LOCAL_IV).decrypt(seg)
        if text:  # 텍스트 파일은 뒤에 붙은 패딩 바이트를 뗀다
            return data[:size].rstrip(bytes(range(17)))
        end = data.find(b"IEND")
        return data[:end + 8] if end >= 0 else data


def unit_anim(packs: "IconPacks", cid: int, form: int) -> int | None:
    raw = packs.get(f"{cid:03d}_{'fcsu'[form]}02.maanim", text=True)
    l = anim_len(raw) if raw else None
    return l + 1 if l is not None else None  # BCU AnimU.getAtkLen() = anims[2].len + 1


def anim_len(raw: bytes) -> int | None:
    """공격 모션 길이(프레임). BCU util/anim/MaAnim.validate + Part.validate/getMax 와 같은 계산."""
    lines = [l.strip() for l in raw.decode("utf-8", "replace").splitlines() if l.strip()]
    try:
        n, i, best = int(lines[2]), 3, 1
        for _ in range(n):
            ints = [int(x) for x in lines[i].split(",")[:5]]
            cnt = int(lines[i + 1])
            frames = [int(lines[i + 2 + k].split(",")[0]) for k in range(cnt)]
            i += 2 + cnt
            if not frames:
                continue
            loop, off = ints[2], 0
            if frames[0] < 0 or loop != 1:      # 첫 키프레임을 0으로 당긴다
                off = -frames[0]
                frames = [f + off for f in frames]
            fir, mx = frames[0], frames[-1]
            if loop != -1:
                m = fir + (mx - fir) * loop - off if loop > 1 else mx - off
            else:
                m = mx - min(off, 0)
            best = max(best, m)
        return best
    except (ValueError, IndexError):
        return None


def icon_names(cid: int, form: int, ub: list[int]) -> list[str]:
    """진화 단계 하나의 아이콘 후보 파일 이름. 알 캐릭은 1·2단계가 알 그림(uniNNN_m00 / _m01)."""
    names = [f"uni{cid:03d}_{'fcsu'[form]}00.png"]
    if ub[61] >= 0 and form == 0:
        names.append(f"uni{ub[61]:03d}_m00.png")
    if ub[61] >= 0 and form == 1:
        names.append(f"uni{ub[62]:03d}_m01.png")
    return names


# ---- 캐릭 상세 (docs/data/units.json) ----
# unitNNN.csv 열 위치. 0~97은 BCU 기준 + 게임 내 설명문과 대조, 98 이후는 설명문 대조로 찾은 위치
# (tools 밖 검증: 각 열 값이 있는 형태의 설명문에 해당 능력 단어가 있는지 전수 비교).
# 81(초극 데미지)·116(폭파 무효)·99~104(2·3타 원거리 범위)는 BCU battle/data/DataUnit.java 기준. 영혼 공격·사도 킬러 등은 아직 표시 안 함.
ABILITY_COLS = [
    # (키, 열, 함께 넣을 값 열들)
    ("strong", 23, []), ("kb", 24, []), ("freeze", 25, [26]), ("slow", 27, [28]), ("resist", 29, []),
    ("massive", 30, []), ("crit", 31, []), ("only", 32, []), ("money", 33, []), ("base", 34, []),
    ("wave", 35, [36]), ("weaken", 37, [38, 39]), ("strengthen", 40, [41]), ("survive", 42, []),
    ("metal", 43, []), ("immWave", 46, []), ("waveBlock", 47, []), ("immKb", 48, []), ("immFreeze", 49, []), ("immSlow", 50, []),
    ("immWeaken", 51, []), ("zombie", 52, []), ("witch", 53, []), ("barrier", 70, []), ("tough", 80, []),
    ("insane", 81, []), ("immBlast", 116, []),  # BCU DataUnit: 81 AB_MASSIVES(초극 데미지), 116 IMUBLAST
    ("savage", 82, [83]), ("dodge", 84, [85]), ("surge", 86, [87, 88, 89]), ("curse", 92, [93]),
    ("shield", 95, []), ("colossus", 97, []), ("behemoth", 105, [106, 107]), ("conjure", 110, []),
    ("sage", 111, []), ("metalKiller", 112, []), ("explosion", 113, [114]),
]
MINI_WAVE, MINI_SURGE = 94, 108


def cell(row: list[str], c: int) -> int:
    v = row[c].strip() if len(row) > c else ""
    return int(v) if v.lstrip("-").isdigit() else 0


def unit_form(row: list[str]) -> dict:
    hits = [cell(row, 3)] + [cell(row, c) for c in (59, 60) if cell(row, c) > 0]
    pre = [cell(row, 13), cell(row, 61), cell(row, 62)][:len(hits)]
    ab = []
    for key, c, extra in ABILITY_COLS:
        if cell(row, c) > 0:
            if key == "wave" and cell(row, MINI_WAVE):
                key = "miniWave"
            if key == "surge" and cell(row, MINI_SURGE):
                key = "miniSurge"
            ab.append([key, cell(row, c), *[cell(row, e) for e in extra]])
    out = {"hp": cell(row, 0), "kb": cell(row, 1), "speed": cell(row, 2), "atk": hits, "pre": pre,
           "tba": cell(row, 4), "range": cell(row, 5), "cost": cell(row, 6), "respawn": cell(row, 7),
           "area": cell(row, 12) == 1, "ab": ab}
    if cell(row, 45):  # 원거리 공격: 시작 위치, 폭
        out["ld"] = [cell(row, 44), cell(row, 45)]
        # 2·3타가 따로 원거리 범위를 가질 때: [사용 여부, 시작, 폭]이 99부터 3칸씩 (BCU DataUnit)
        lds = [[cell(row, 44), cell(row, 45)]]
        for i in range(1, len(hits)):
            b = 99 + (i - 1) * 3
            lds.append([cell(row, b + 1), cell(row, b + 2)] if cell(row, b) == 1 else lds[0])
        if len(lds) > 1 and any(l != lds[0] for l in lds[1:]):
            out["lds"] = lds
    return out


def xp_index(curves: list[list[int]], costs: list[int]) -> int:
    if costs not in curves:
        curves.append(costs)
    return curves.index(costs)


def evolve(ub: list[int], xp_col: int, items_col: int, used: set[int]) -> dict | None:
    """진화 재료: {"xp", "items": [[아이템 ID, 개수], ...]}. 이름은 gamedata.js의 items에서 찾는다."""
    items = [[ub[items_col + i * 2], ub[items_col + i * 2 + 1]] for i in range(5)]
    items = [it for it in items if it[1] > 0]
    used.update(i for i, _ in items)
    if not items and ub[xp_col] <= 0:
        return None
    return {"xp": ub[xp_col], "items": items}


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--files", default=DEFAULT_FILES)
    ap.add_argument("--version", default="15.6.0")
    args = ap.parse_args(argv)

    G, data_version = game_data_dir(args.version)
    D, R = os.path.join(G, "DataLocal"), os.path.join(G, "resLocal")

    skill_desc = {}
    for line in read(os.path.join(R, "SkillDescriptions.csv"))[1:]:
        tid, text = line.split("|", 1)
        skill_desc[int(tid)] = text.strip()

    talents: dict[int, list[dict]] = {}
    talent_desc: dict[int, dict[int, str]] = {}
    talent_vals: dict[int, dict[int, list[int]]] = {}
    for line in read(os.path.join(D, "SkillAcquisition.csv"))[1:]:
        r = [int(x) for x in line.split(",") if x.strip()]
        lst = []
        for i in range(2, len(r) - 13, 14):
            ability, max_lv, text_id, limit = r[i], r[i + 1], r[i + 10], r[i + 13]
            if not ability:
                continue
            desc = skill_desc.get(text_id, "")
            lst.append({"id": ability, "name": talent_name(desc), "max": max(max_lv, 1),
                        "ultra": limit == 1, "trait": talent_trait(desc)})
        talents[r[0]] = lst
        talent_desc[r[0]] = {r[i]: skill_desc.get(r[i + 10], "").replace("<br>", " ")
                             for i in range(2, len(r) - 13, 14) if r[i]}
        # 본능 효과 원본값: [최대 레벨, 최소1, 최대1, 최소2, 최대2, ...] — 레벨별 계산은 사이트에서 (BCU PCoin 방식)
        talent_vals[r[0]] = {r[i]: [r[i + 1], *r[i + 2:i + 10]] for i in range(2, len(r) - 13, 14) if r[i]}

    item_names = [l.split("|")[0].strip() for l in read(os.path.join(R, "GatyaitemName.csv"))]
    # 세이브의 catfruit 리스트 순서 = Matatabi.tsv 행 순서 (개다래 씨앗·열매, 수석). [아이템 ID, 씨앗 여부, 그룹]
    matatabi = [[int(r[0]), r[1] == "1", int(r[2])]
                for r in (l.split("\t") for l in read(os.path.join(D, "Matatabi.tsv"))[1:]) if r and r[0].strip()]
    # 세이브의 catseyes 리스트 순서 = Gatyaitembuy.csv 에서 category 5 를 index 순으로 (아이템 ID = 행 번호)
    buy = [l.split(",") for l in read(os.path.join(D, "Gatyaitembuy.csv"))[1:]]
    catseyes = [i for _, i in sorted((int(r[7]), i) for i, r in enumerate(buy) if len(r) > 7 and r[6].strip() == "5")]
    used_items: set[int] = {m[0] for m in matatabi} | set(catseyes)
    # 본능옥: 세이브의 본능옥 ID = equipmentlist.json "ID" 배열 위치. [효과 종류, 대상 속성(없으면 -1), 등급 0~4=D~S, 값]
    with open(os.path.join(D, "equipmentlist.json"), encoding="utf-8") as fp:
        orb_list = [[o["content"], o.get("attribute", -1), o["gradeID"], (o.get("value") or [0])[0]]
                    for o in json.load(fp)["ID"]]
    orb_names = [re.sub(r"\s*%@.*$", "", l.split("\t")[0]).strip()
                 for l in read(os.path.join(R, "equipment_explonation.tsv")) if l.strip()]
    # 슬롯: 캐릭 ID → 슬롯별 조건 (0 = 3진부터, 1 = 3진 + Lv60). 조건 열이 없으면 전부 0
    orb_slots = {}
    for l in read(os.path.join(D, "equipmentslot.csv")):
        r = [x for x in l.split("//")[0].split(",") if x.strip()]
        if len(r) >= 2:
            n = int(r[1])
            orb_slots[int(r[0])] = [int(x) for x in r[2:2 + n]] if len(r) >= 2 + n else [0] * n
    curves = [[int(x) for x in l.split(",") if x.strip()] for l in read(os.path.join(D, "unitlevel.csv"))]
    # 레벨업 경험치 표 (unitbuy 2~11열, 같은 표끼리 묶어 gamedata.xpCurves 에 한 번만 둔다)
    xp_curves: list[list[int]] = []
    # 레어 뽑기 세트에 들어 있는 캐릭 (GatyaDataSetR1.csv: 한 줄 = 뽑기 세트 하나의 캐릭 목록)
    rare_gacha = {int(x) for l in read(os.path.join(D, "GatyaDataSetR1.csv"))
                  for x in l.split(",") if x.strip().lstrip("-").isdigit() and int(x) >= 0}
    # 세계편 스테이지 이름 (기본 캐릭 해금 조건용). 이름 파일은 거꾸로 적혀 있다 (build_stages.main_story_name)
    eoc_names = [l.split("|")[0].strip() for l in read(os.path.join(R, "StageName0_ko.csv"))]
    eoc_name = lambda s: eoc_names[s if s >= 46 else 45 - s] if 0 <= (s if s >= 46 else 45 - s) < len(eoc_names) else f"{s + 1}번째 스테이지"
    units: dict[int, dict] = {}

    packs = IconPacks(args.files)
    icon_dir = os.path.join(SITE, "icons")
    shutil.rmtree(icon_dir, ignore_errors=True)
    os.makedirs(icon_dir)
    n_icons = 0

    cats = []
    for cid, line in enumerate(read(os.path.join(D, "unitbuy.csv"))):
        ub = [int(x) for x in line.split("//")[0].split(",") if x.strip()]
        expl = os.path.join(R, f"Unit_Explanation{cid + 1}_ko.csv")
        stats = os.path.join(D, f"unit{cid + 1:03d}.csv")
        if not os.path.exists(expl) or not os.path.exists(stats):
            continue
        expl_rows = [l.split("|") for l in read(expl)]
        names = [r[0].strip() for r in expl_rows]
        if not names or DUMMY_NAME.fullmatch(names[0]):
            continue  # "730_1" 같은 미출시 더미
        stat_rows = [l.split("//")[0].split(",") for l in read(stats) if l.strip()]
        forms = []
        for f, name in enumerate(names[:4]):
            if not name or f >= len(stat_rows) or DUMMY_NAME.fullmatch(name):
                break
            # 3진·4진 진화가 없는 캐릭(unitbuy 23·24열이 0)은 데이터에 가짜 단계 이름이 들어 있다 → 뺀다.
            # 대부분 앞 단계 이름과 같지만, 100만불 고양이(#635 "1억불의 고양이")처럼 살짝 다른 것도 있다
            if f >= 2 and ub[21 + f] <= 0:
                break
            row = stat_rows[f]
            traits = [t for c, t in TRAIT_COLS.items() if len(row) > c and row[c].strip() == "1"]
            png = next((p for p in map(packs.get, icon_names(cid, f, ub)) if p), None)
            if png:
                with open(os.path.join(icon_dir, f"{cid}_{f}.png"), "wb") as fp:
                    fp.write(png)
                n_icons += 1
            forms.append({"name": name, "traits": traits, "icon": png is not None})
        if not forms:
            continue
        cats.append({
            "id": cid,
            "rarity": ub[13],
            "forms": forms,
            "maxLevel": ub[50] or ub[19],
            # 뽑기로 안 나오는 레어 이상 캐릭은 겹칠 수 없어 플러스 레벨이 없다 (51열에 70이 남아 있는 #53·#319)
            "maxPlus": 0 if ub[12] == 0 and ub[13] >= 2 else ub[51],
            # 진화 아이템 ID가 0이면 해당 진화 없음. 요구 레벨: 25/26열(열매 진화), 없으면 20열(기본캐릭), 0=스테이지 해금 등
            "tfLevel": max(ub[25], ub[20], 0) if len(forms) >= 3 and ub[23] > 0 else None,
            "ffLevel": max(ub[26], 0) if len(forms) >= 4 and ub[24] > 0 else None,
            # 진화 비용 (내 도감의 "바로 진화 가능" 판정·육성 계획용, 상세 데이터 없이 쓰려고 목록에도 둔다)
            "tfCost": evolve(ub, 27, 28, used_items) if len(forms) >= 3 and ub[23] > 0 else None,
            "ffCost": evolve(ub, 38, 39, used_items) if len(forms) >= 4 and ub[24] > 0 else None,
            "talents": talents.get(cid, []),
            # 레벨업: 경험치 표 번호, 캣츠아이가 필요해지는 레벨(이 레벨 초과부터, 없으면 -1)
            "xpc": xp_index(xp_curves, ub[2:12]),
            "eye": ub[49] if ub[49] > 0 and (ub[50] or 0) > ub[49] else -1,
            # 얻는 방법: src(unitbuy 12열: 0 = 뽑기 아님, 1 = 냥코 뽑기, 2 = 뽑기), 레어 뽑기 세트 포함 여부,
            # 기본 캐릭은 세계편 해금 스테이지와 구매 경험치. 스테이지 드롭은 build_stages.py 의 cat_drops.json
            "get": {"src": ub[12], **({"rare": 1} if cid in rare_gacha else {}),
                    **({"unlock": [eoc_name(ub[0] - 1) if ub[0] > 0 else None, ub[1]]} if ub[13] == 0 else {})},
        })
        units[cid] = {
            "desc": [" ".join(x.strip() for x in expl_rows[f][1:] if x.strip()) for f in range(len(forms))],
            "forms": [{**unit_form(stat_rows[f]), "anim": unit_anim(packs, cid, f)} for f in range(len(forms))],
            "curve": curves[cid] if cid < len(curves) else [],
            "tf": evolve(ub, 27, 28, used_items) if len(forms) >= 3 else None,
            "ff": evolve(ub, 38, 39, used_items) if len(forms) >= 4 else None,
            "talentDesc": talent_desc.get(cid, {}),
            "talentVals": talent_vals.get(cid, {}),
        }

    out = {"version": data_version, "builtFor": args.version, "rarities": RARITY, "traits": list(TRAIT_COLS.values()),
           "items": {i: item_names[i] if i < len(item_names) else f"아이템 {i}" for i in sorted(used_items)},
           "matatabi": matatabi, "catseyes": catseyes, "currencyItems": CURRENCY_ITEMS,
           # 본능옥 대상 속성 (equipment_attribute.csv 열 순서. 9·10은 쓰이지 않음)
           "orbs": {"list": orb_list, "names": orb_names, "slots": orb_slots,
                    "traits": ["빨강", "떠있음", "검정", "메탈", "천사", "에이리언", "좀비", "고대종", "무속성", "마녀", "사도", "악마"]},
           "xpCurves": xp_curves, "cats": cats}
    with open(os.path.join(SITE, "gamedata.js"), "w", encoding="utf-8") as f:
        f.write("window.GAMEDATA = ")
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    os.makedirs(os.path.join(SITE, "data"), exist_ok=True)
    with open(os.path.join(SITE, "data", "units.json"), "w", encoding="utf-8") as f:
        json.dump(units, f, ensure_ascii=False, separators=(",", ":"))
    # 재료·재화 아이콘: docs/icons/items/<아이템 ID>.png
    item_dir = os.path.join(icon_dir, "items")
    os.makedirs(item_dir)
    item_icons = []
    for i in sorted(used_items | set(CURRENCY_ITEMS.values())):
        png = packs.get(f"gatyaitemD_{i:02d}_f.png")
        if png:
            with open(os.path.join(item_dir, f"{i}.png"), "wb") as fp:
                fp.write(png)
            item_icons.append(i)
    print(f"아이템 아이콘 {len(item_icons)}개 (없음: {sorted((used_items | set(CURRENCY_ITEMS.values())) - set(item_icons))})")
    print(f"캐릭 {len(cats)}종, 아이콘 {n_icons}개, 본능 보유 캐릭 {sum(1 for c in cats if c['talents'])}종")


if __name__ == "__main__":
    main()
