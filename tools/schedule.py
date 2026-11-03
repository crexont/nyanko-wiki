"""게임 서버의 이벤트 일정(sale·gatya·item.tsv)을 받아 사이트용 JSON으로 만든다.

이벤트 서버는 계정 토큰이 있어야 파일을 준다. 사용자 계정은 절대 쓰지 않고,
일정 읽기 전용 익명 계정 하나를 처음에 한 번 만들어 계속 쓴다 (매번 새로 만들지 않음).

사용:
  python tools/schedule.py --init      읽기 전용 계정을 만들어 schedule_reader.json 에 저장 (한 번만)
  python tools/schedule.py             받기 → build/schedule/*.tsv + docs/data/schedule.json
  python tools/schedule.py --offline   이미 받은 build/schedule/*.tsv 로 JSON만 다시 만들기
계정 정보는 schedule_reader.json 또는 환경변수 NYANKO_READER(같은 JSON 문자열, Actions 시크릿)에서 읽는다.
"""
from __future__ import annotations

import argparse
import datetime
import json
import os
import re
import sys
import urllib.request

from bcsfe import core
from bcsfe.core.server.event_data import FilterData

from common import ROOT, use_local_bcsfe_dir

READER_FILE = os.path.join(ROOT, "schedule_reader.json")
RAW_DIR = os.path.join(ROOT, "build", "schedule")
DEFAULT_OUT = os.path.join(ROOT, "docs", "data", "schedule.json")
EVENTS_URL = "https://nyanko-events.ponosgames.com/battlecatskr_production/"
FILES = ("sale", "gatya", "item")
KST = datetime.timezone(datetime.timedelta(hours=9))


def default_version() -> str:
    """사이트 데이터(gamedata.js)를 만든 게임 버전."""
    with open(os.path.join(ROOT, "docs", "gamedata.js"), encoding="utf-8") as f:
        m = re.search(r'"builtFor":"([\d.]+)"', f.read())
    return m.group(1) if m else "15.6.0"


def empty_save(version: str) -> core.SaveFile:
    return core.SaveFile(cc=core.CountryCode.from_code("kr"), gv=core.GameVersion.from_string(version))


# ---------- 계정 ----------

def init_reader(version: str) -> None:
    if os.path.exists(READER_FILE):
        sys.exit(f"이미 있음: {READER_FILE} (새로 만들려면 지우고 다시 실행)")
    s = empty_save(version)
    h = core.ServerHandler(s, print=False)
    if not h.create_new_account():
        sys.exit("읽기 전용 계정을 만들지 못함")
    reader = {
        "inquiry_code": s.inquiry_code,
        "password": h.get_stored_password(),
        "password_refresh_token": s.password_refresh_token,
    }
    with open(READER_FILE, "w", encoding="utf-8", newline="\n") as f:
        json.dump(reader, f, ensure_ascii=False, indent=1)
    print(f"저장: {READER_FILE}")
    print("GitHub Actions 시크릿 NYANKO_READER 에 아래 한 줄을 넣는다:")
    print(json.dumps(reader, separators=(",", ":")))


def load_reader() -> dict:
    text = os.environ.get("NYANKO_READER")
    if not text and os.path.exists(READER_FILE):
        with open(READER_FILE, encoding="utf-8") as f:
            text = f.read()
    if not text:
        sys.exit("계정 정보 없음: --init 을 먼저 하거나 NYANKO_READER 를 설정")
    return json.loads(text)


def get_token(reader: dict, version: str) -> str:
    """저장된 비밀번호로 토큰만 받는다. 실패해도 새 계정을 만들지 않는다
    (bcsfe의 get_auth_token 은 실패하면 계정을 새로 만들어 버려서 직접 부른다)."""
    s = empty_save(version)
    s.inquiry_code = reader["inquiry_code"]
    s.password_refresh_token = reader["password_refresh_token"]
    token = core.ServerHandler(s, print=False).get_auth_token_new(reader["password"])
    if not token:
        sys.exit("토큰을 받지 못함 (계정 정보가 만료됐으면 --init 으로 다시 만든다)")
    return token


def download(token: str) -> dict[str, bytes]:
    out = {}
    for name in FILES:
        req = urllib.request.Request(f"{EVENTS_URL}{name}.tsv?jwt={token}",
                                     headers={"accept-encoding": "identity"})
        with urllib.request.urlopen(req, timeout=30) as r:
            out[name] = r.read()
    return out


# ---------- 파싱 ----------

def when(ymd: int, hm: int) -> str | None:
    """20261103, 1100 → '2026-11-03T11:00+09:00'. 0 이면 None (기한 없음)."""
    if not ymd:
        return None
    y, mo, d = ymd // 10000, ymd // 100 % 100, ymd % 100
    if y >= 2030:  # 서버가 "끝 없음"을 먼 미래 날짜로 적는다
        return None
    t = datetime.datetime(y, mo, d) + datetime.timedelta(hours=hm // 100, minutes=hm % 100)  # 2400 = 다음 날 0시
    return t.strftime("%Y-%m-%dT%H:%M+09:00")


def filter_json(fd) -> dict:
    """공통 앞부분(기간·버전·요일/날짜/시간 조건)."""
    out = {"start": when(fd.start_yyyymmdd, fd.start_hhmm),
           "end": when(fd.end_yyyymmdd, fd.end_hhmm),
           "minVer": fd.min_game_version, "maxVer": fd.max_game_version}
    rules = []
    for it in fd.filter_items:
        r = {}
        if it.filter_date:
            fdt = it.filter_date
            r["date"] = [fdt.start_mmdd, fdt.start_hhmm, fdt.end_mmdd, fdt.end_hhmm]
        days = [i + 1 for i, v in enumerate(it.filter_day_flags) if v]
        if days:
            r["days"] = days
        if it.filter_week:
            r["week"] = it.filter_week
        if it.filter_times_start_end_hhmm:
            r["times"] = [list(t) for t in it.filter_times_start_end_hhmm]
        rules.append(r)
    if any(rules):
        out["rules"] = rules
    return out


def rows(raw: bytes):
    """[start] … [end] 사이의 행을 bcsfe Row 로 하나씩 돌려준다."""
    csv = core.CSV(core.Data(raw), delimiter="\t", remove_comments=False, remove_empty=False)
    first = csv.read_line()
    if first is None or first.next_str() != "[start]":
        raise ValueError("[start] 없음")
    while True:
        row = csv.read_line()
        if row is None or len(row) == 0 or row[0].to_str() == "[end]":
            return
        yield row


def parse_sale(raw: bytes) -> list[dict]:
    out = []
    for row in rows(raw):
        e = filter_json(FilterData.from_csv_row(row))
        n = row.next_int()
        e["maps"] = [row.next_int() for _ in range(n)]
        out.append(e)
    return out


GATYA_KIND = {0: "normal", 1: "rare", 2: "rare", 3: "rare", 4: "collab"}


def parse_gatya(raw: bytes) -> list[dict]:
    out = []
    for row in rows(raw):
        it = core.ServerGatyaDataItem.from_csv_row(row)
        e = filter_json(it.filter)
        e["kind"] = GATYA_KIND.get(it.flags, str(it.flags))
        e["sets"] = [{
            "id": s.number,
            "price": s.catfood,
            "flags": s.flags,
            # 레어도별 [확률(만분율), 확정 여부] — 0 기본 … 4 레전드
            "rates": [[r.prob, r.guaranteed] for r in s.rarity_info],
            "msg": s.message,
        } for s in it.sets]
        out.append(e)
    return out


def parse_item(raw: bytes) -> list[dict]:
    out = []
    for row in rows(raw):
        it = core.ServerItemDataItem.from_csv_row(row)
        e = filter_json(it.filter)
        e.update({"event": it.event_number, "item": it.item_number, "count": it.item_unit,
                  "title": it.title, "msg": it.message, "flags": it.flags})
        out.append(e)
    return out


def build(raw: dict[str, bytes]) -> dict:
    now = datetime.datetime.now(KST)
    parsed = {"sale": parse_sale(raw["sale"]), "gatya": parse_gatya(raw["gatya"]),
              "item": parse_item(raw["item"])}
    # 서버가 아는 가장 새 게임 버전 (행마다 최소 버전이 있다). 사이트 데이터 버전보다 새 이벤트도 보여야 해서
    # 우리 gamedata 버전이 아니라 이걸 기준으로 옛 버전 전용 행만 뺀다.
    gv = max(e["minVer"] for rows_ in parsed.values() for e in rows_)
    def live(e):
        return (not e["maxVer"] or gv <= e["maxVer"]) and (not e["end"] or now.isoformat() < e["end"])
    out = {"fetchedAt": now.isoformat(timespec="seconds"),
           "gameVersion": f"{gv // 10000}.{gv // 100 % 100}.{gv % 100}"}
    for k, rows_ in parsed.items():
        out[k] = [e for e in rows_ if live(e)]
    return out


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--init", action="store_true", help="읽기 전용 계정 만들기 (한 번만)")
    ap.add_argument("--offline", action="store_true", help="받지 않고 build/schedule/*.tsv 로만")
    ap.add_argument("--version", default=None, help="게임 버전 (기본: gamedata.js builtFor)")
    ap.add_argument("-o", "--out", default=DEFAULT_OUT)
    args = ap.parse_args(argv)
    use_local_bcsfe_dir()
    core.core_data.init_data()
    version = args.version or default_version()

    if args.init:
        init_reader(version)
        return

    if args.offline:
        raw = {}
        for name in FILES:
            with open(os.path.join(RAW_DIR, f"{name}.tsv"), "rb") as f:
                raw[name] = f.read()
    else:
        raw = download(get_token(load_reader(), version))
        os.makedirs(RAW_DIR, exist_ok=True)
        for name, data in raw.items():
            with open(os.path.join(RAW_DIR, f"{name}.tsv"), "wb") as f:
                f.write(data)

    data = build(raw)
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{args.out}: 스테이지 {len(data['sale'])}, 뽑기 {len(data['gatya'])}, 아이템 {len(data['item'])}")


if __name__ == "__main__":
    main()
