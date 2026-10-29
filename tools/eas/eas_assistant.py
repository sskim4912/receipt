"""Aurora → EAS one-receipt assistant. Never saves an EAS voucher.

Without --edge this only validates the local handoff file. Browser mode delegates
to eas_receipt_bridge, which reuses the user's preserved EAS connection script.
"""
from __future__ import annotations

import argparse
from datetime import date, datetime, timedelta, timezone
import json
from pathlib import Path
import re
import sys
import unicodedata
from urllib.parse import urlsplit

SSO_URL = "https://sso.gsenc.com/sso/std/ssoLogin_pin.jsp"
LIST_URL = "https://eas.gsenc.com/ep/cc/vouc/EpCcVouc0001"
DETAIL_PATH = "/ep/cc/vouc/EpCcVouc0002"
INPUTS = {
    "employeeName": 'input[name="useName"]',
    "attendeeCount": 'input[name="empCnt"]',
    "purpose": 'input[name="resn"]',
}
MATCH_KEYS = {"approvalNumber", "receiptDate", "amount", "cardLast4", "merchantName", "businessNumber"}
REQUIRED_IDENTITY = {"approvalNumber", "receiptDate", "amount", "registration"}


class SafetyStop(Exception):
    """A safe message, without credentials, URLs with queries or page dumps."""


def require(condition, message):
    if not condition:
        raise SafetyStop(message)


def read_json(path):
    path = Path(path)
    require(path.stat().st_size <= 512_000, "JSON 파일이 너무 큽니다.")
    return json.loads(path.read_text(encoding="utf-8-sig"))


def integer(value, minimum, maximum):
    return type(value) is int and minimum <= value <= maximum


def valid_date(value):
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        return False
    try:
        date.fromisoformat(value)
        return True
    except ValueError:
        return False


def validate_handoff(data, now=None):
    require(isinstance(data, dict), "연결 파일 형식이 잘못되었습니다.")
    require(set(data) == {"format", "formatVersion", "receiptId", "receiptVersion", "exportedAt", "match", "fields"},
            "지원하지 않는 항목이 포함된 연결 파일입니다. 웹에서 다시 내려받으세요.")
    require(data["format"] == "aurora-eas-handoff" and type(data["formatVersion"]) is int and data["formatVersion"] == 1,
            "지원하지 않는 연결 파일 버전입니다.")
    require(isinstance(data["receiptId"], str) and re.fullmatch(r"[a-zA-Z0-9_-]{1,100}", data["receiptId"]), "등록번호 오류입니다.")
    require(integer(data["receiptVersion"], 1, 2**53-1), "문서 버전 오류입니다.")
    try:
        exported = datetime.fromisoformat(data["exportedAt"].replace("Z", "+00:00"))
        require(exported.tzinfo is not None, "내보낸 시각에 시간대가 없습니다.")
        age = (now or datetime.now(timezone.utc)) - exported
        require(-timedelta(minutes=5) <= age <= timedelta(hours=24), "24시간 내 연결 파일을 사용하세요. 웹에서 다시 내려받으세요.")
    except (ValueError, TypeError, AttributeError):
        raise SafetyStop("내보낸 시각 오류입니다.") from None
    match, fields = data["match"], data["fields"]
    require(isinstance(match, dict) and set(match) == MATCH_KEYS, "거래 확인 항목 오류입니다.")
    require(isinstance(fields, dict) and set(fields) == set(INPUTS), "자동입력은 실사용자·인원수·목적만 지원합니다.")
    for key, limit in (("employeeName", 160), ("purpose", 1000)):
        value = fields[key]
        require(isinstance(value, str) and value == value.strip() and 0 < len(value) <= limit,
                "실사용자·목적을 웹에서 수정 후 다시 내려받으세요.")
        # Selenium treats private-use codepoints as keys (including Enter).
        require(not any(ord(c) < 32 or ord(c) == 127 or 0xE000 <= ord(c) <= 0xF8FF for c in value),
                "입력값에 제어문자·자동화 특수키가 포함되어 있습니다.")
    require(integer(fields["attendeeCount"], 1, 99), "인원수는 정수 1~99이어야 합니다.")
    require(valid_date(match["receiptDate"]), "사용일자 오류입니다.")
    require(integer(match["amount"], 1, 999_999_999_999), "영수금액 오류입니다.")
    for key, pattern in (("approvalNumber", r"\d{1,40}"), ("cardLast4", r"\d{4}"),
                         ("businessNumber", r"(?:\d{10}|\d{3}-\d{2}-\d{5})")):
        value = match[key]
        require(value is None or (isinstance(value, str) and re.fullmatch(pattern, value, re.ASCII)), "거래 식별값 형식 오류입니다.")
    require(match["merchantName"] is None or (isinstance(match["merchantName"], str) and 0 < len(match["merchantName"]) <= 160),
            "거래처 형식 오류입니다.")
    return data


def validate_selectors(config):
    require(isinstance(config, dict) and set(config) <= {"listReady", "detailScope", "detailFrame", "identity"},
            "거래 확인 설정 형식 오류입니다.")
    for key in ("listReady", "detailScope"):
        require(isinstance(config.get(key), str) and config[key].strip(), "실제 EAS에서 확인한 listReady·detailScope 설정이 필요합니다.")
    identity = config.get("identity")
    require(isinstance(identity, dict) and REQUIRED_IDENTITY <= set(identity) <= MATCH_KEYS | {"registration"},
            "승인번호·일자·금액·업체등록 상태 selector가 모두 필요합니다.")
    require(all(isinstance(v, str) and v.strip() for v in identity.values()), "비어 있는 selector는 사용할 수 없습니다.")
    require(config.get("detailFrame") is None or (isinstance(config["detailFrame"], str) and config["detailFrame"].strip()),
            "프레임 selector 오류입니다.")
    return config


def normalized(key, value):
    value = unicodedata.normalize("NFC", str(value)).strip()
    if key == "amount":
        require(re.fullmatch(r"(?:[0-9]+|[0-9]{1,3}(?:,[0-9]{3})+)(?:\s*원)?", value), "EAS 금액 형식을 확인할 수 없습니다.")
        return int(re.sub(r"[,\s원]", "", value))
    if key == "receiptDate":
        value = value.replace(".", "-").replace("/", "-")
        if re.fullmatch(r"[0-9]{8}", value):
            value = f"{value[:4]}-{value[4:6]}-{value[6:]}"
        require(valid_date(value), "EAS 사용일자 형식을 확인할 수 없습니다.")
    if key == "businessNumber":
        value = value.replace("-", "")
    return value


def verify_transaction(payload, observed):
    require(REQUIRED_IDENTITY <= set(observed), "EAS 거래 정보를 모두 확인하지 못했습니다.")
    registration = str(observed["registration"]).strip()
    require(registration != "미등록", "자동처리 제외: 업체등록 필요")
    require(registration == "Y", "업체등록 상태를 확정할 수 없습니다. 자동입력을 중단합니다.")
    require(payload["match"]["approvalNumber"], "승인번호가 없어 1차 버전은 자동입력하지 않습니다.")
    for key in REQUIRED_IDENTITY - {"registration"}:
        require(normalized(key, observed[key]) == normalized(key, payload["match"][key]),
                f"거래 정보 불일치: {key}. 입력하지 않습니다.")
    for key in MATCH_KEYS - {"approvalNumber", "receiptDate", "amount"}:
        expected = payload["match"][key]
        if key in observed and expected is not None:
            require(normalized(key, observed[key]) == normalized(key, expected),
                    f"추가 거래 정보 불일치: {key}. 입력하지 않습니다.")


def visible_one(root, selector):
    elements = [e for e in root.find_elements("css selector", selector) if e.is_displayed()]
    require(len(elements) == 1, "화면 항목을 하나로 확정하지 못했습니다. 화면 구조·복수 후보를 확인하세요.")
    return elements[0]


def element_value(element):
    value = element.get_attribute("value")
    return value if value is not None else element.text


def close_known_notices(driver):
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.common.exceptions import StaleElementReferenceException

    def gone(element):
        try:
            return not element.is_displayed()
        except StaleElementReferenceException:
            return True

    for popup in driver.find_elements("css selector", ".react-draggable"):
        if not popup.is_displayed():
            continue
        require("[전사필독]" in popup.text, "예상하지 못한 팝업입니다. 직접 확인 후 다시 실행하세요.")
        close = visible_one(popup, ".dialog-no-drag-area")
        require(close.tag_name in ("button", "a") or close.get_attribute("role") == "button",
                "공지 닫기 영역을 확정할 수 없습니다. 공지를 직접 닫고 다시 실행하세요.")
        close.click()
        WebDriverWait(driver, 5).until(lambda _: gone(popup))


def trusted_page(driver, detail=False):
    url = urlsplit(driver.current_url)
    allowed = {DETAIL_PATH} if detail else {DETAIL_PATH, "/ep/cc/vouc/EpCcVouc0001"}
    require(url.scheme == "https" and url.hostname == "eas.gsenc.com" and url.port in (None, 443) and url.path in allowed,
            "EAS 대상 화면이 아니거나 로그인 세션이 만료되었습니다.")


def read_context(driver, config):
    from selenium.common.exceptions import NoAlertPresentException
    trusted_page(driver, detail=True)
    driver.switch_to.default_content()
    try:
        driver.switch_to.alert
        raise SafetyStop("예상하지 못한 브라우저 알림이 있습니다. 입력하지 않습니다.")
    except NoAlertPresentException:
        pass
    # Do not dismiss arbitrary dialogs, and do not inspect authentication values.
    require(not any(e.is_displayed() for e in driver.find_elements("css selector", ".react-draggable")),
            "팝업이 남아 있습니다. 직접 확인 후 다시 실행하세요.")
    if config.get("detailFrame"):
        driver.switch_to.frame(visible_one(driver, config["detailFrame"]))
        require(driver.execute_script("return location.origin;") == "https://eas.gsenc.com",
                "대상 상세 프레임의 출처를 확인할 수 없습니다.")
    scope = visible_one(driver, config["detailScope"])
    for popup in driver.find_elements("css selector", '[role="dialog"], .MuiDialog-root'):
        if popup.is_displayed():
            require(driver.execute_script("return arguments[0].contains(arguments[1]);", popup, scope),
                    "대상 상세 이외의 팝업이 있습니다. 입력하지 않습니다.")
    observed = {key: element_value(visible_one(scope, selector)) for key, selector in config["identity"].items()}
    return scope, observed


def fill_verified(driver, config, payload, context_reader=None):
    from selenium.webdriver.common.keys import Keys
    read = context_reader or (lambda: read_context(driver, config))
    scope, observed = read()
    verify_transaction(payload, observed)
    # Validate every target before changing even the first input.
    for key, selector in INPUTS.items():
        field = visible_one(scope, selector)
        require(field.is_enabled() and not field.get_attribute("readonly"), "수정할 수 없는 입력란입니다.")
        limit = field.get_attribute("maxlength")
        require(not limit or int(limit) < 0 or len(str(payload["fields"][key])) <= int(limit), "EAS 입력 길이를 초과합니다.")
        require(field.get_attribute("type") not in ("password", "hidden", "submit"), "예상하지 못한 입력란입니다.")
    for key, selector in INPUTS.items():
        scope, observed = read()
        verify_transaction(payload, observed)
        field = visible_one(scope, selector)
        field.click()
        field.send_keys(Keys.CONTROL, "a")
        field.send_keys(Keys.BACKSPACE)
        field.send_keys(str(payload["fields"][key]))
        field.send_keys(Keys.TAB)
        scope, observed = read()
        verify_transaction(payload, observed)
        require(element_value(visible_one(scope, selector)) == str(payload["fields"][key]), "입력값 검증 실패입니다. 일부 값이 입력됐을 수 있으니 직접 확인하세요.")
    scope, observed = read()
    verify_transaction(payload, observed)
    require(all(element_value(visible_one(scope, sel)) == str(payload["fields"][key]) for key, sel in INPUTS.items()),
            "포커스 이동 후 입력값이 유지되지 않았습니다. 직접 확인하세요.")


def run_edge(payload, config=None, driver_path=None):
    require(not config and not driver_path,
            "기존 접속 코드를 보존하는 연결 버전을 사용하세요. 별도 selector/driver 옵션 대신 eas_receipt_bridge.py를 실행하세요.")
    from eas_receipt_bridge import run_connection
    return run_connection(payload)


def main():
    parser = argparse.ArgumentParser(description="EAS 한 건 자동입력 보조 도구 (저장 자동화 없음)")
    parser.add_argument("--receipt", help="웹에서 내려받은 eas-등록번호.json")
    parser.add_argument("--edge", action="store_true", help="기존 기준 코드 기반 연결 실행 (eas_receipt_bridge.py 권장)")
    parser.add_argument("--selectors", help="실제 EAS에서 확인한 CSS selector 설정 JSON")
    parser.add_argument("--driver", help="회사에서 제공한 msedgedriver.exe 경로 (선택)")
    args = parser.parse_args()
    try:
        receipt_path = args.receipt
        if not receipt_path:
            import tkinter as tk
            from tkinter.filedialog import askopenfilename
            root = tk.Tk()
            root.withdraw()
            receipt_path = askopenfilename(title="EAS 연결 파일 선택", filetypes=[("JSON", "*.json")])
            root.destroy()
            require(receipt_path, "파일 선택을 취소했습니다.")
        payload = validate_handoff(read_json(receipt_path))
        print("연결 파일 검증 완료. 운영 데이터와 처리상태는 변경하지 않았습니다.")
        if not args.edge:
            print("로컬 검증 모드입니다. Edge·EAS를 열거나 입력하지 않았습니다.")
            return 0
        require(not args.selectors and not args.driver,
                "새 연결 버전은 기존 접속 코드를 사용합니다. eas_receipt_bridge.py를 실행하세요.")
        return run_edge(payload)
    except SafetyStop as error:
        print(f"중단: {error}", file=sys.stderr)
    except Exception as error:
        # Do not dump Selenium exception bodies, browser URLs, tokens or receipt values.
        print(f"중단: 실행 환경 또는 화면 오류 ({type(error).__name__}). 입력·저장 성공으로 간주하지 마세요.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    # Ensure the bridge shares this module's SafetyStop class and validators.
    sys.modules.setdefault("eas_assistant", sys.modules[__name__])
    sys.exit(main())
