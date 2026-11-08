"""게임 업데이트 뒤 사이트 데이터를 한 번에 다시 만든다.

블루스택에서 게임을 업데이트하고 한 번 실행한 뒤 완전히 종료하고 실행한다.
  1. extract_vhdx --with-packs   기기에서 세이브·팩 꺼내기
  2. 세이브에서 게임 버전 읽기
  3. unpack_gamedata              APK 데이터 팩 → bcsfe 게임 데이터 폴더
  4. build_gamedata → build_enemies → build_stages → build_gatya_sets → build_np → build_items (이 순서여야 아이콘이 안 지워진다)
  5. 바뀐 내용 요약 (새 캐릭·진화·본능, 적·스테이지 수)
사용: python tools/update_gamedata.py [--version 15.7.0]   (--version 을 주면 2를 건너뛴다)
"""
from __future__ import annotations

import argparse
import json
import os

from bcsfe import core

import build_enemies
import build_gamedata
import build_gatya_sets
import build_items
import build_np
import build_stages
import extract_vhdx
import unpack_gamedata
from common import ROOT, use_local_bcsfe_dir

DOCS = os.path.join(ROOT, "docs")


def save_version() -> str:
    use_local_bcsfe_dir()
    with open(os.path.join(ROOT, "device", "SAVE_DATA"), "rb") as f:
        s = core.SaveFile(core.Data(f.read()), core.CountryCode.from_code("kr"))
    return s.game_version.to_string()


def snapshot() -> dict:
    """요약용: 캐릭(이름·형태·본능), 적 수, 맵·스테이지 수."""
    out = {"cats": {}, "enemies": 0, "maps": 0, "stages": 0, "version": "?"}
    try:
        with open(os.path.join(DOCS, "gamedata.js"), encoding="utf-8") as f:
            s = f.read()
        gd = json.loads(s[s.index("{"):s.rindex("}") + 1])
        out["version"] = gd.get("builtFor", "?")
        out["cats"] = {c["id"]: ([f["name"] for f in c["forms"]], c["talents"]) for c in gd["cats"]}
        with open(os.path.join(DOCS, "data", "enemies.json"), encoding="utf-8") as f:
            en = json.load(f)
        out["enemies"] = len(en) if isinstance(en, list) else len(en.get("list", en))
        with open(os.path.join(DOCS, "data", "stages", "index.json"), encoding="utf-8") as f:
            idx = json.load(f)
        out["maps"] = sum(len(c["maps"]) for c in idx["categories"])
        out["stages"] = sum(m[2] for c in idx["categories"] for m in c["maps"])
    except (OSError, ValueError, KeyError):
        pass
    return out


def summary(a: dict, b: dict) -> None:
    print(f"\n=== 바뀐 내용 (v{a['version']} → v{b['version']}) ===")
    new = [i for i in b["cats"] if i not in a["cats"]]
    gone = [i for i in a["cats"] if i not in b["cats"]]
    forms = [i for i in b["cats"] if i in a["cats"] and len(b["cats"][i][0]) > len(a["cats"][i][0])]
    tal = [i for i in b["cats"] if i in a["cats"] and b["cats"][i][1] != a["cats"][i][1]]
    print(f"캐릭 {len(a['cats'])} → {len(b['cats'])}종")
    for i in new:
        print(f"  새 캐릭 #{i} {b['cats'][i][0][0]} ({len(b['cats'][i][0])}형태)")
    for i in gone:
        print(f"  빠진 캐릭 #{i} {a['cats'][i][0][0]}")
    for i in forms:
        print(f"  진화 추가 #{i} {b['cats'][i][0][-1]} ({len(a['cats'][i][0])} → {len(b['cats'][i][0])}형태)")
    for i in tal:
        print(f"  본능 변경 #{i} {b['cats'][i][0][-1]}")
    print(f"적 {a['enemies']} → {b['enemies']}종, 맵 {a['maps']} → {b['maps']}, 스테이지 {a['stages']} → {b['stages']}")
    print("확인 후 git diff 로 보고 커밋한다.")


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--version", help="게임 버전 (생략하면 꺼낸 세이브에서 읽는다)")
    ap.add_argument("--skip-extract", action="store_true", help="device/ 에 이미 꺼낸 것을 쓴다")
    args = ap.parse_args(argv)

    if not args.skip_extract:
        extract_vhdx.main(["--with-packs"])
    version = args.version or save_version()
    print(f"게임 버전 {version}")
    before = snapshot()
    unpack_gamedata.main(["--version", version])
    v = ["--version", version]
    build_gamedata.main(v)
    build_enemies.main(v)
    build_stages.main(v)
    build_gatya_sets.main(v)
    build_np.main(v)
    build_items.main(v)
    summary(before, snapshot())


if __name__ == "__main__":
    main()
