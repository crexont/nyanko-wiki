"""세이브 파일을 읽기 전용으로 파싱해서 보유 캐릭 JSON을 만든다. 세이브는 수정하지 않는다.

사용: python tools/export_save.py [세이브 경로] [-o 출력.json]
기본: device/SAVE_DATA (extract_vhdx.py 가 꺼낸 것) → 냥코_세이브.json (사이트에서 불러오는 파일)
"""
from __future__ import annotations

import argparse
import datetime
import json
import os

from bcsfe import core

from common import ROOT, use_local_bcsfe_dir

DEFAULT_SAVE = os.path.join(ROOT, "device", "SAVE_DATA")
DEFAULT_OUT = os.path.join(ROOT, "냥코_세이브.json")


def export(raw: bytes, source: str, modified: str) -> dict:
    """세이브 바이트 → 사이트에서 불러오는 JSON (dict). 세이브는 읽기만 한다."""
    s = core.SaveFile(core.Data(raw), core.CountryCode.from_code("kr"))

    cats = []
    for c in s.cats.cats:
        if not c.unlocked:
            continue
        cats.append({
            "id": c.id,
            "form": c.current_form,
            "level": c.upgrade.base + 1,
            "plus": c.upgrade.plus,
            "talents": {str(t.id): t.level for t in (c.talents or [])},
        })

    return {
        "source": source,
        "saveModified": modified,
        "exportedAt": datetime.datetime.now().isoformat(timespec="minutes"),
        "gameVersion": s.game_version.to_string(),
        "catfood": s.catfood,
        "xp": s.xp,
        # 재화·재료 (v2.0~). 개다래·수석·캐츠아이는 세이브 순서 그대로 내보내고 이름은 사이트(gamedata.js)가 붙인다
        # → 추출 도구는 게임 데이터를 내려받을 필요가 없다.
        "currency": {"xp": s.xp, "np": s.np, "catfood": s.catfood,
                     "normalTickets": s.normal_tickets, "rareTickets": s.rare_tickets,
                     "platinumTickets": s.platinum_tickets, "legendTickets": s.legend_tickets},
        "catfruit": list(s.catfruit),
        "catseyes": list(s.catseyes),
        "orbs": {str(i): o.value for i, o in s.talent_orbs.orbs.items()},
        "cats": cats,
    }


def write(out: dict, path: str) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    cats = out["cats"]
    forms = [sum(1 for c in cats if c["form"] == i) for i in range(4)]
    print(f"{out['source']} (v{out['gameVersion']}) → {path}")
    print(f"보유 {len(cats)}마리 (1진 {forms[0]} / 2진 {forms[1]} / 3진 {forms[2]} / 4진 {forms[3]}), "
          f"통조림 {out['catfood']}, XP {out['xp']}")


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("save", nargs="?", default=DEFAULT_SAVE)
    ap.add_argument("-o", "--out", default=DEFAULT_OUT)
    args = ap.parse_args(argv)
    use_local_bcsfe_dir()

    with open(args.save, "rb") as f:
        raw = f.read()
    modified = datetime.datetime.fromtimestamp(os.path.getmtime(args.save)).isoformat(timespec="minutes")
    write(export(raw, os.path.basename(args.save), modified), args.out)


if __name__ == "__main__":
    main()
