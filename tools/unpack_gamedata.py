"""기기 APK에서 꺼낸 DataLocal·resLocal 팩을 bcsfe 게임 데이터 폴더 형식으로 푼다.

bcsfe 서버에 새 버전 데이터가 아직 없을 때 쓴다. bcsfe는 bcsfe_data/game_data/kr/<버전>/ 에
DataLocal/·resLocal/ 과 빈 "downloaded" 파일이 있으면 그 버전을 그대로 쓴다 (build_gamedata 등 game_data_dir).
사용: python tools/extract_vhdx.py --with-packs → python tools/unpack_gamedata.py --version 15.7.0
"""
from __future__ import annotations

import argparse
import os

from Crypto.Cipher import AES

from build_gamedata import LIST_KEY, LOCAL_IV, LOCAL_KEY
from common import BCSFE_DIR, ROOT

PACKS = ("DataLocal", "resLocal")


def unpad(data: bytes) -> bytes:
    n = data[-1] if data else 0
    return data[:-n] if 0 < n <= 16 and data.endswith(bytes([n]) * n) else data


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--version", required=True, help="게임 버전 (예: 15.7.0)")
    ap.add_argument("--device", default=os.path.join(ROOT, "device"))
    args = ap.parse_args(argv)
    out_root = os.path.join(BCSFE_DIR, "game_data", "kr", args.version)
    for pack in PACKS:
        lst, pk = (os.path.join(args.device, f"{pack}.{e}") for e in ("list", "pack"))
        raw = AES.new(LIST_KEY, AES.MODE_ECB).decrypt(open(lst, "rb").read())
        rows = [l.split(",") for l in unpad(raw).decode("utf-8").splitlines()[1:]]
        data = open(pk, "rb").read()
        out = os.path.join(out_root, pack)
        os.makedirs(out, exist_ok=True)
        for name, off, size in (r[:3] for r in rows):
            seg = data[int(off):int(off) + int(size)]
            plain = AES.new(LOCAL_KEY, AES.MODE_CBC, LOCAL_IV).decrypt(seg[:len(seg) // 16 * 16])
            with open(os.path.join(out, name), "wb") as f:
                f.write(unpad(plain))
        print(f"{pack}: {len(rows)}개 → {out}")
    open(os.path.join(out_root, "downloaded"), "wb").close()


if __name__ == "__main__":
    main()
