"""이어하기 코드로 세이브를 받아 사이트용 JSON을 만들고, 받은 세이브를 그대로 다시 올려 새 코드를 발급한다.

이어하기 코드는 한 번 쓰면 소모돼서, 게임을 계속하려면 새 코드가 필요하다. 그래서
  1. 코드로 세이브 받기 (POST nyanko-save /v2/transfers/<코드>/reception)
  2. 받은 원본을 build/transfer/ 에 백업 + 냥코_세이브.json 만들기
  3. 원본 바이트 그대로 다시 올리고 새 이어하기 코드 받기 → 게임에서 이 코드로 이어하기
     (새 코드는 화면에 보여주고 이어하기_코드.txt 에도 덧붙인다)
세이브는 절대 고치지 않는다 (bcsfe의 get_codes 는 세이브를 다시 저장해서 올리고, 실패하면 새 계정을 만들어
버리므로 쓰지 않고 같은 요청을 직접 보낸다). 3이 실패하면 --retry <백업.sav> 로 다시 올린다.

사용: python tools/transfer.py <이어하기 코드> <인증번호>
      python tools/transfer.py --retry build/transfer/<시각>.sav
"""
from __future__ import annotations

import argparse
import datetime
import json
import os
import re
import sys

from bcsfe import core

import export_save
from common import FROZEN, ROOT, use_local_bcsfe_dir

SAVE_URL = "https://nyanko-save.ponosgames.com"
BACKUP_DIR = os.path.join(ROOT, "build", "transfer")
OUT = os.path.join(ROOT, "냥코_세이브.json")
CODES_TXT = os.path.join(ROOT, "이어하기_코드.txt")
UA = "Dalvik/2.1.0 (Linux; U; Android 9; SM-G955F Build/N2G48B)"
KR = core.CountryCode.from_code("kr")


def default_version() -> str:
    try:
        with open(os.path.join(ROOT, "docs", "gamedata.js"), encoding="utf-8") as f:
            m = re.search(r'"builtFor":"([\d.]+)"', f.read())
        return m.group(1) if m else "15.7.0"
    except OSError:
        return "15.7.0"


def compact(obj) -> str:
    return json.dumps(obj, separators=(",", ":"), ensure_ascii=False)


def receive(code: str, pin: str, version: str) -> tuple[bytes, dict]:
    """(세이브 원본 바이트, 계정 정보 {password, refresh}). 비밀번호가 없어도 세이브는 돌려준다 (먼저 백업해야 해서)."""
    data = core.ClientInfo(KR, core.GameVersion.from_string(version)).get_client_info()
    data["pin"] = pin
    headers = {"content-type": "application/json", "accept-encoding": "gzip", "connection": "keep-alive", "user-agent": UA}
    r = core.RequestHandler(f"{SAVE_URL}/v2/transfers/{code}/reception", headers, core.Data(compact(data))).post()
    if r is None:
        sys.exit("서버에 연결하지 못함 (인터넷 확인)")
    if r.headers.get("content-type", "") != "application/octet-stream":
        sys.exit("세이브를 받지 못함: 이어하기 코드·인증번호를 확인 (코드는 그대로 남아 있음)")
    return r.content, {"password": r.headers.get("Nyanko-Password"),
                       "refresh": r.headers.get("Nyanko-Password-Refresh-Token")}


def reupload(raw: bytes, password: str) -> tuple[str, str]:
    """원본 바이트를 그대로 올리고 (이어하기 코드, 인증번호)."""
    s = core.SaveFile(core.Data(raw), KR)
    h = core.ServerHandler(s, print=False)
    token = h.get_auth_token_new(password)  # 실패해도 새 계정을 만들지 않는 함수만 쓴다
    if not token:
        raise RuntimeError("토큰 받기 실패")
    key = h.get_save_key_new(token)
    if not key:
        raise RuntimeError("업로드 키 받기 실패")
    form = core.MultipartForm()
    for k, v in key.items():
        if k != "url":
            form.add_key(k, str(v).encode(), "text/plain")
    form.add_key("file", raw, "application/octet-stream", "file.sav")
    r = core.RequestHandler(key.get("url") or "https://nyanko-service-data-prd.s3.amazonaws.com/",
                            {"accept-encoding": "gzip", "connection": "keep-alive", "user-agent": UA}, form=form).post(no_timeout=True)
    if r is None or r.status_code != 204:
        raise RuntimeError(f"세이브 올리기 실패 ({r.status_code if r is not None else '연결 안 됨'})")
    meta = core.BackupMetaData.create_static(s.inquiry_code, s.officer_pass.play_time, s.calculate_user_rank(), [], key["key"])
    headers = core.AccountHeaders(s, meta).get_headers()
    headers["authorization"] = "Bearer " + token
    r = core.RequestHandler(f"{SAVE_URL}/v2/transfers", headers, core.Data(meta)).post()
    payload = (r.json() if r is not None else {}).get("payload") or {}
    if not payload.get("transferCode") or not payload.get("pin"):
        raise RuntimeError("새 이어하기 코드 받기 실패")
    return payload["transferCode"], payload["pin"]


def save_codes(code: str, pin: str) -> str | None:
    """창을 닫아도 남도록 CODES_TXT 에 덧붙인다 (맨 아래가 최신). 실패하면 None."""
    try:
        new = not os.path.exists(CODES_TXT)
        with open(CODES_TXT, "a", encoding="utf-8-sig" if new else "utf-8") as f:
            if new:
                f.write("냥코위키가 발급받은 새 이어하기 코드 (맨 아래가 최신, 한 번 쓴 코드는 다시 못 써요)\n"
                        "이어하기 코드는 비밀번호와 같아요. 남에게 보여주지 마세요.\n\n")
            f.write(f"{datetime.datetime.now():%Y-%m-%d %H:%M}  이어하기 코드 {code}  인증번호 {pin}\n")
        return CODES_TXT
    except OSError:
        return None


def show_codes(code: str, pin: str) -> None:
    saved = save_codes(code, pin)
    print("\n" + "=" * 40)
    print(f"  새 이어하기 코드 : {code}")
    print(f"  새 인증번호     : {pin}")
    print("=" * 40)
    print("게임 첫 화면 → 이어하기 에서 위 코드를 입력하면 그대로 계속할 수 있어요.")
    print(f"이 코드는 {saved} 에도 적어 뒀어요.\n" if saved else "코드를 파일에 적지 못했어요. 꼭 따로 적어 두세요.\n")


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("code", nargs="?")
    ap.add_argument("pin", nargs="?")
    ap.add_argument("--retry", help="백업한 .sav 를 다시 올려 새 코드만 받기")
    ap.add_argument("--version", default=None, help="게임 버전 (기본: 사이트 데이터 버전)")
    ap.add_argument("-y", "--yes", action="store_true", help="확인 묻지 않기")
    args = ap.parse_args(argv)
    use_local_bcsfe_dir()
    core.core_data.init_data()

    if args.retry:
        with open(args.retry, "rb") as f:
            raw = f.read()
        with open(args.retry + ".auth.json", encoding="utf-8") as f:
            password = json.load(f)["password"]
        show_codes(*reupload(raw, password))
        return

    if not args.code or not args.pin:
        ap.error("이어하기 코드와 인증번호가 필요해요")
    if not args.yes:
        print("이어하기 코드는 한 번 쓰면 사라져요. 세이브를 받은 뒤 그대로 다시 올려 새 코드를 드리니,\n"
              "끝나면 게임에서 새 코드로 이어하기 해야 해요. 세이브 내용은 바꾸지 않아요.")
        if input("계속할까요? (y/n) ").strip().lower() != "y":
            return

    raw, auth = receive(args.code.strip(), args.pin.strip(), args.version or default_version())
    password = auth["password"]
    os.makedirs(BACKUP_DIR, exist_ok=True)
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = os.path.join(BACKUP_DIR, f"{stamp}.sav")
    with open(backup, "wb") as f:
        f.write(raw)
    with open(backup + ".auth.json", "w", encoding="utf-8") as f:
        json.dump(auth, f)
    print(f"받은 세이브 백업: {backup}")
    if not password:
        sys.exit("세이브는 받았지만 계정 비밀번호가 응답에 없어서 다시 올리지 못했어요. 백업 파일을 보관해 주세요.")

    try:
        export_save.write(export_save.export(raw, "이어하기 코드", datetime.datetime.now().isoformat(timespec="minutes")), OUT)
    except Exception as e:  # 읽기 실패해도 새 코드는 꼭 받아야 한다
        print(f"세이브를 읽지 못함 ({e}). 새 코드는 계속 받습니다.")

    try:
        code, pin = reupload(raw, password)
    except RuntimeError as e:
        print(f"\n{e}. 아래 명령으로 다시 시도해 주세요 (세이브는 백업에 그대로 있어요):")
        print(f'  NyankoWiki.exe --retry "{backup}"' if FROZEN else f'  python tools/transfer.py --retry "{backup}"')
        sys.exit(1)
    show_codes(code, pin)


if __name__ == "__main__":
    main()
