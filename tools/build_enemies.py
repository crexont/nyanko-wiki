"""적 데이터를 사이트용으로 빌드한다 (개발용, build_gamedata.py 다음에 실행).

- CSV: t_unit.csv(스탯, 행 = 적 ID + 2), Enemyname.tsv(이름), EnemyPictureBook_ko.csv(도감 설명),
  enemy_dictionary_list.csv(도감에 나오는 적)
- 열 의미: BCU(오픈소스 시뮬레이터) battle/data/DataEnemy.java (slow_kotlin 브랜치) 와 같다.
- 아이콘·공격 모션: build_gamedata.py 와 같은 팩 (enemy_icon_NNN.png, NNN_e02.maanim)

출력: docs/data/enemies.json, docs/icons/enemy/<id>.png
사용: python tools/extract_vhdx.py --with-packs → python tools/build_enemies.py [--version 버전 (기본: docs/gamedata.js 버전)]
"""
from __future__ import annotations

import argparse
import json
import os
import shutil

from build_gamedata import DEFAULT_FILES, IconPacks, SITE, anim_len, cell, default_version, game_data_dir, read

# 게임 데이터에 없는 적 아이콘 (나무위키 등에서 받아 둔 것): 간판 아가씨(#21) — 나무위키 "냥코 대전쟁 적 023"
EXTRA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "extra_icons", "enemy")

# 속성 열 → 이름 (BCU DataEnemy 의 TRAIT_*)
TRAIT_COLS = [(10, "빨강"), (13, "떠있음"), (14, "검정"), (15, "메탈"), (16, "무속성"), (17, "천사"),
              (18, "에이리언"), (19, "좀비"), (72, "고대종"), (93, "악마"), (48, "마녀"), (71, "사도"),
              (94, "초생명체"), (101, "초수"), (104, "초현자"), (110, "괴인")]
# 켜기만 하면 되는 능력 (열, 키)
FLAG_COLS = [(37, "immWave"), (38, "waveBlock"), (39, "immKb"), (40, "immFreeze"), (41, "immSlow"),
             (42, "immWeaken"), (70, "immWarp"), (85, "immSurge"), (103, "counterSurge"), (105, "immCurse"),
             (109, "immBlast")]


def abilities(r: list[str]) -> list[list]:
    """[키, 값...] 목록. 시간은 프레임, 거리는 게임 단위(열 값 / 4)."""
    ab = []
    add = lambda key, *v: ab.append([key, *v])
    if cell(r, 20): add("kb", cell(r, 20))
    if cell(r, 21): add("freeze", cell(r, 21), cell(r, 22))
    if cell(r, 23): add("slow", cell(r, 23), cell(r, 24))
    if cell(r, 25): add("crit", cell(r, 25))
    if cell(r, 26): add("base")
    if cell(r, 27): add("miniWave" if cell(r, 86) == 1 else "wave", cell(r, 27), cell(r, 28))
    if cell(r, 29): add("weaken", cell(r, 29), cell(r, 30), cell(r, 31))
    if cell(r, 32): add("strengthen", cell(r, 32), cell(r, 33))
    if cell(r, 34): add("survive", cell(r, 34))
    if cell(r, 43): add("burrow", cell(r, 43), cell(r, 44) // 4)          # 횟수(-1 = 무한), 거리
    if cell(r, 45): add("revive", cell(r, 45), cell(r, 46), cell(r, 47))   # 횟수(-1 = 무한), 시간, 체력%
    if cell(r, 64): add("barrierHp", cell(r, 64))          # 베리어 체력 (아군의 "베리어 브레이커"와 구분)
    if cell(r, 65): add("warp", cell(r, 65), cell(r, 66), cell(r, 67) // 4, cell(r, 68) // 4)
    if cell(r, 73): add("curse", cell(r, 73), cell(r, 74))
    if cell(r, 75): add("savage", cell(r, 75), cell(r, 76))
    if cell(r, 77): add("dodge", cell(r, 77), cell(r, 78))
    if cell(r, 79): add("toxic", cell(r, 79), cell(r, 80))                 # 확률, 최대 체력의 %
    if cell(r, 81):  # 열파: 확률, 시작, 끝, 레벨 (102 = 소열파)
        d0 = cell(r, 82) // 4
        add("miniSurge" if cell(r, 102) == 1 else "surge", cell(r, 81), d0, d0 + cell(r, 83) // 4, cell(r, 84))
    if cell(r, 87): add("demonShield", cell(r, 87), cell(r, 88))           # 악마 쉴드 체력, 넉백 시 회복%
    if cell(r, 89):
        d0 = cell(r, 90) // 4
        add("deathSurge", cell(r, 89), d0, d0 + cell(r, 91) // 4, cell(r, 92))
    if cell(r, 106):
        d0 = cell(r, 107) // 4
        add("blast", cell(r, 106), d0, d0 + cell(r, 108) // 4)
    if cell(r, 111): add("delay", cell(r, 111), cell(r, 112))
    for c, key in FLAG_COLS:
        if cell(r, c) == 1:
            add(key)
    return ab


def enemy_stats(r: list[str]) -> dict:
    hits = [cell(r, 3)] + [cell(r, c) for c in (55, 56) if cell(r, c) > 0]
    pre = [cell(r, 12), cell(r, 57), cell(r, 58)][:len(hits)]
    out = {"hp": cell(r, 0), "kb": cell(r, 1), "speed": cell(r, 2), "atk": hits, "pre": pre,
           "tba": cell(r, 4), "range": cell(r, 5), "money": cell(r, 6), "area": cell(r, 11) == 1,
           "ab": abilities(r)}
    if cell(r, 36):  # 원거리: 시작, 폭. 2·3타가 따로 가지면 95부터 [사용 여부, 시작, 폭] 3칸씩
        lds = [[cell(r, 35), cell(r, 36)]]
        for i in range(1, len(hits)):
            b = 95 + (i - 1) * 3
            lds.append([cell(r, b + 1), cell(r, b + 2)] if cell(r, b) == 1 else lds[0])
        out["ld"] = lds[0]
        if any(l != lds[0] for l in lds[1:]):
            out["lds"] = lds
    if cell(r, 69):
        out["star"] = 1   # 별 에이리언 (보물 효과를 덜 받는다)
    return out


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--files", default=DEFAULT_FILES)
    ap.add_argument("--version", default=default_version())
    args = ap.parse_args(argv)

    G, _ = game_data_dir(args.version)
    D, R = os.path.join(G, "DataLocal"), os.path.join(G, "resLocal")
    rows = [l.split(",") for l in read(os.path.join(D, "t_unit.csv"))]
    names = [l.split("\t")[0].strip() for l in read(os.path.join(R, "Enemyname.tsv"))]
    books = read(os.path.join(R, "EnemyPictureBook_ko.csv"))
    in_dex = {int(l.split(",")[0]) for l in read(os.path.join(D, "enemy_dictionary_list.csv")) if l.strip()}

    packs = IconPacks(args.files)
    icon_dir = os.path.join(SITE, "icons", "enemy")
    shutil.rmtree(icon_dir, ignore_errors=True)
    os.makedirs(icon_dir)

    enemies, n_icon = [], 0
    for eid, name in enumerate(names):
        if eid + 2 >= len(rows):
            continue
        r = rows[eid + 2]
        if not any(cell(r, c) for c in range(7)):
            continue  # 비어 있는 자리
        # 이름이 "ダミー"(일본판도 같음)인 적은 도감에 안 나오는 적. 스테이지에는 나오니 이름 없이 넣고 목록에선 숨긴다
        nameless = not name or name == "ダミー"
        e = {"id": eid, "name": f"이름 없는 적 #{eid}" if nameless else name, "traits": [t for c, t in TRAIT_COLS if cell(r, c) == 1], **enemy_stats(r)}
        if eid < len(books):
            parts = [p.strip() for p in books[eid].split("|")[1:] if p.strip()]
            if parts:
                e["desc"] = " ".join(parts)
        if eid in in_dex:
            e["dex"] = 1
        if nameless:
            e["hidden"] = 1
        raw = packs.get(f"{eid:03d}_e02.maanim", text=True)
        l = anim_len(raw) if raw else None
        if l is not None:
            e["anim"] = l + 1   # BCU AnimU.getAtkLen() = anims[2].len + 1
        png = packs.get(f"enemy_icon_{eid:03d}.png")
        if png:
            with open(os.path.join(icon_dir, f"{eid}.png"), "wb") as fp:
                fp.write(png)
            e["icon"] = 1
            n_icon += 1
        else:
            # 게임 팩에 아이콘이 없는 적(간판 아가씨 등)은 tools/extra_icons/enemy/<id>.<png|webp> 를 쓴다.
            # icon 값은 확장자 (png면 1)
            for ext in ("png", "webp"):
                extra = os.path.join(EXTRA_DIR, f"{eid}.{ext}")
                if os.path.exists(extra):
                    shutil.copyfile(extra, os.path.join(icon_dir, f"{eid}.{ext}"))
                    e["icon"] = 1 if ext == "png" else ext
                    n_icon += 1
                    break
        enemies.append(e)

    with open(os.path.join(SITE, "data", "enemies.json"), "w", encoding="utf-8") as f:
        json.dump(enemies, f, ensure_ascii=False, separators=(",", ":"))
    print(f"적 {len(enemies)}종 (이름 없음 {sum(1 for e in enemies if e.get('hidden'))}, 도감 {sum(1 for e in enemies if e.get('dex'))}), 아이콘 {n_icon}개, "
          f"공격 모션 없음 {sum(1 for e in enemies if 'anim' not in e)}")


if __name__ == "__main__":
    main()
