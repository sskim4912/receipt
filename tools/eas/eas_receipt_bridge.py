"""Connect one exported receipt to the user's UNMODIFIED EAS login script.

Only the confirmed IBSheet columns and labelled detail rows are read. A unique
visible candidate requires desktop confirmation before its date cell is double
clicked. Only the three confirmed inputs are ever edited. Never submits/saves.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from contextlib import redirect_stdout, redirect_stderr
from dataclasses import dataclass
from datetime import datetime
import importlib
import re
import sys
import time
from urllib.parse import urlsplit

from eas_assistant import (
    SafetyStop, require, read_json, validate_handoff, normalized,
    fill_verified, trusted_page, INPUTS,
)

GRID_SELECTOR = '[id="sheetEpCcVouc0001_1"]'
COLUMNS = ("useDate", "cardNum", "useAmt", "joinStorName", "regiYn")
LABELS = {"approvalNumber": "승인번호", "receiptDate": "사용일자", "amount": "사용금액", "cardLast4": "카드번호"}
PROOF_TTL = 600


@contextmanager
def elapsed_step(label):
    """Only fixed stage names and elapsed seconds, never URLs or receipt data."""
    started = time.monotonic()
    try:
        yield
    finally:
        print(f"[소요 시간] {label}: {time.monotonic() - started:.1f}초")


class ResponsiveBaseline:
    """Keep the private login module intact; wait for the EAS UI after login.

    The original module still owns Edge, SSO, login detection, known notice
    discovery/clicks and browser maintenance. No authentication state is read.
    """
    def __init__(self, baseline):
        self.baseline = baseline

    def __getattr__(self, name):
        return getattr(self.baseline, name)

    def open_eas_card_list(self, driver):
        from selenium.common.exceptions import TimeoutException
        from selenium.webdriver.support.ui import WebDriverWait
        # Navigate to the exact established URL, not a value from the receipt.
        try:
            driver.get("https://eas.gsenc.com/ep/cc/vouc/EpCcVouc0001")
        except TimeoutException:
            # As in the original, allow slow subresources, but require the grid.
            pass

        def ready(current):
            from selenium.common.exceptions import StaleElementReferenceException
            url = urlsplit(current.current_url)
            require(url.scheme == 'https' and url.hostname == 'eas.gsenc.com'
                    and url.port in (None, 443), 'EAS 접속 또는 로그인 상태를 확인해주세요.')
            if url.path != '/ep/cc/vouc/EpCcVouc0001':
                return False
            try:
                grids = [e for e in current.find_elements('css selector', GRID_SELECTOR)
                         if e.is_displayed()]
                require(len(grids) <= 1, '사용내역 목록이 여러 개라 진행하지 않습니다.')
                return bool(grids)
            except StaleElementReferenceException:
                return False

        WebDriverWait(driver, 20, poll_frequency=0.2).until(ready)
        return True

    def close_all_startup_notices(self, driver):
        from selenium.common.exceptions import StaleElementReferenceException
        from selenium.webdriver.support.ui import WebDriverWait
        # The grid is already rendered. Observe a full quiet interval after it
        # and after each known popup, rather than always waiting eight seconds.
        quiet_since = time.monotonic()
        closed = 0
        while time.monotonic() - quiet_since < self.baseline.NOTICE_NEXT_WAIT:
            trusted_page(driver)
            popups = self.baseline.get_visible_notice_popups(driver)
            if popups:
                require(closed < self.baseline.MAX_NOTICE_COUNT,
                        '공지가 계속 나타나 자동 처리를 중단했습니다.')
                # Original selector/click handling remains the only dismissal.
                require(self.baseline.close_one_notice(driver),
                        '기존 코드가 공지를 닫지 못했습니다.')

                def gone(_):
                    for popup in popups:
                        try:
                            if popup.is_displayed():
                                return False
                        except StaleElementReferenceException:
                            pass
                    return True

                WebDriverWait(driver, 5, poll_frequency=0.2).until(gone)
                closed += 1
                require(closed < self.baseline.MAX_NOTICE_COUNT,
                        '공지가 최대 처리 개수에 도달해 자동 처리를 중단했습니다.')
                quiet_since = time.monotonic()
            else:
                time.sleep(0.2)
        # Late/unknown dialogs are also checked again during every transaction
        # read and before/after each field edit. They stop input, never bypass it.
        guard_screen(driver)
        return True


class DiscardOutput:
    """Do not retain baseline URL/exception prints that may contain SSO queries."""
    def write(self, value):
        return len(value)

    def flush(self):
        pass


def baseline_call(function, *args):
    # Functions and their behaviour stay unchanged. Only console output is muted.
    labels = {'wait_for_login': '로그인 완료 감지(사용자 로그인 포함)',
              'open_eas_card_list': 'EAS 목록 준비',
              'close_all_startup_notices': '공지 처리'}
    label = labels.get(function.__name__)
    started = time.monotonic()
    try:
        with redirect_stdout(DiscardOutput()), redirect_stderr(DiscardOutput()):
            return function(*args)
    finally:
        if label:
            print(f"[소요 시간] {label}: {time.monotonic() - started:.1f}초")


def only_visible(root, by, selector, description):
    elements = [element for element in root.find_elements(by, selector) if element.is_displayed()]
    require(len(elements) == 1, f"{description}을 한 개로 확정하지 못했습니다. 자동입력을 중단합니다.")
    return elements[0]


def guard_screen(driver, detail=False):
    from selenium.common.exceptions import NoAlertPresentException
    trusted_page(driver, detail=detail)
    driver.switch_to.default_content()
    try:
        driver.switch_to.alert
        raise SafetyStop("브라우저 알림이 표시되어 있습니다. 직접 확인하세요.")
    except NoAlertPresentException:
        pass
    for selector in (".react-draggable", '[role="dialog"], .MuiDialog-root, .MuiPopover-root'):
        require(not any(e.is_displayed() for e in driver.find_elements("css selector", selector)),
                "팝업이 남아 있습니다. 거래 입력 전에 직접 확인하세요.")


def list_date(value):
    return normalized("receiptDate", value)


def detail_date(value):
    value = value.strip()
    require(re.fullmatch(r"[0-9]{4}\.[0-9]{2}\.[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}", value),
            "상세 사용일시 형식이 확인한 화면과 다릅니다.")
    try:
        return datetime.strptime(value, "%Y.%m.%d %H:%M:%S").date().isoformat()
    except ValueError:
        raise SafetyStop("상세 사용일시가 유효하지 않습니다.") from None


def last_four(value):
    # Read only the displayed masked card text; never export/log the card number.
    value = value.strip().replace(" ", "")
    match = re.fullmatch(r"[0-9]{4}-[0-9]{4}-[Xx*]{4}-([0-9]{4})", value)
    require(match, "카드 일부번호가 확인한 마스킹 형식과 다릅니다.")
    return match.group(1)


def read_list_row(row):
    cells = row.find_elements("css selector", "td")
    found = {}
    prefixes = set()
    for cell in cells:
        for token in (cell.get_attribute("class") or "").split():
            match = re.fullmatch(r"HideCol([0-9]+)(useDate|cardNum|useAmt|joinStorName|regiYn)", token)
            if match:
                key = match.group(2)
                require(key not in found, "한 행에 거래 열이 중복되어 있습니다.")
                found[key] = cell
                prefixes.add(match.group(1))
    require(set(found) == set(COLUMNS) and len(prefixes) == 1,
            "목록의 거래 열을 모두 확인하지 못했습니다. 화면 구조가 달라졌을 수 있습니다.")
    require(all(e.is_displayed() for e in found.values()), "거래 확인 열이 숨겨져 있습니다.")
    amount_text = found["useAmt"].text.strip()
    require(not amount_text.startswith("-"), "취소·음수 거래는 자동처리 대상이 아닙니다.")
    values = {
        "receiptDate": list_date(found["useDate"].text.strip()),
        "amount": normalized("amount", amount_text),
        "cardLast4": last_four(found["cardNum"].text),
        "merchantName": found["joinStorName"].text.strip(),
        "registration": found["regiYn"].text.strip(),
    }
    require(values["amount"] > 0 and values["merchantName"], "거래 금액·거래처가 비어 있습니다.")
    return values, found["useDate"]


def matches_list(payload, values):
    expected = payload["match"]
    if values["receiptDate"] != expected["receiptDate"] or values["amount"] != expected["amount"]:
        return False
    for key in ("cardLast4", "merchantName"):
        if expected[key] is not None and normalized(key, expected[key]) != normalized(key, values[key]):
            return False
    return True


@dataclass(frozen=True)
class Candidate:
    row: object
    values: tuple


@dataclass(frozen=True)
class RegistrationProof:
    # A transient snapshot of the SAME row approved and opened in this session.
    values: tuple
    receipt_id: str
    receipt_version: int
    match_values: tuple
    captured_at: float


def find_candidate(driver, payload):
    guard_screen(driver)
    require(urlsplit(driver.current_url).path == "/ep/cc/vouc/EpCcVouc0001", "EAS 사용내역 목록 화면이 아닙니다.")
    grid = only_visible(driver, "css selector", GRID_SELECTOR, "사용내역 목록")
    rows = [row for row in grid.find_elements("css selector", "tr.IBDataRow") if row.is_displayed()]
    require(rows, "표시된 거래가 없습니다. 사용내역 목록을 먼저 조회하세요.")
    candidates = []
    for row in rows:
        values, _ = read_list_row(row)
        if matches_list(payload, values):
            candidates.append(Candidate(row, tuple(sorted(values.items()))))
    require(candidates, "현재 표시된 목록에서 일치하는 거래가 없습니다. EAS에서 검색 범위를 좁히고 다시 실행하세요.")
    require(len(candidates) == 1, "같은 조건의 후보가 여러 개입니다. 임의 선택하지 않습니다. 목록 검색으로 대상을 좁히세요.")
    candidate = candidates[0]
    registration = dict(candidate.values)["registration"]
    require(registration != "미등록", "자동처리 제외: 업체등록 필요")
    require(registration == "Y", "업체등록 상태를 확정할 수 없습니다.")
    return candidate


def capture_registration(driver, payload, candidate):
    # Re-read after the user has confirmed. A refresh/reorder/change is not trusted.
    current = find_candidate(driver, payload)
    require(current.row == candidate.row and current.values == candidate.values,
            "확인 중 목록 거래가 바뀌었습니다. 입력하지 않습니다.")
    _, date_cell = read_list_row(current.row)
    proof = RegistrationProof(current.values, payload["receiptId"], payload["receiptVersion"],
                              tuple(sorted(payload["match"].items())), time.monotonic())
    return proof, date_cell


def verify_proof(payload, proof):
    require(isinstance(proof, RegistrationProof), "같은 세션의 업체등록 확인이 없습니다.")
    require(0 <= time.monotonic() - proof.captured_at <= PROOF_TTL, "거래 확인 후 10분이 지났습니다. 목록부터 다시 확인하세요.")
    require(proof.receipt_id == payload["receiptId"] and proof.receipt_version == payload["receiptVersion"]
            and proof.match_values == tuple(sorted(payload["match"].items())), "연결 파일이 거래 확인 이후 달라졌습니다.")
    values = dict(proof.values)
    require(values.get("registration") == "Y" and matches_list(payload, values), "같은 거래의 업체등록 확인이 없습니다.")
    return values


def read_detail(driver, payload, proof):
    validate_handoff(payload)
    guard_screen(driver, detail=True)
    values = verify_proof(payload, proof)
    observed = {"registration": values["registration"], "merchantName": values["merchantName"]}
    for key, label in LABELS.items():
        # Labels were supplied by the user in actual th/td rows. No MUI hashes.
        xpath = f"//tr[th//*[normalize-space(.)='{label}']]/td"
        cell = only_visible(driver, "xpath", xpath, f"상세 {label}")
        raw = cell.text.strip()
        if key == "receiptDate":
            observed[key] = detail_date(raw)
        elif key == "cardLast4":
            observed[key] = last_four(raw)
        elif key == "amount":
            observed[key] = normalized(key, raw)
        else:
            require(re.fullmatch(r"[0-9]{1,40}", raw), "상세 승인번호 형식을 확인할 수 없습니다.")
            observed[key] = raw
    for key in ("receiptDate", "amount", "cardLast4"):
        require(observed[key] == values[key], "목록에서 확인한 거래와 상세 거래가 다릅니다.")
    return driver, observed


def detail_ready(driver):
    """URL changes before React finishes loading the detail and its three fields."""
    from selenium.common.exceptions import StaleElementReferenceException
    guard_screen(driver, detail=True)
    try:
        for label in LABELS.values():
            xpath = f"//tr[th//*[normalize-space(.)='{label}']]/td"
            cells = [e for e in driver.find_elements('xpath', xpath) if e.is_displayed()]
            require(len(cells) <= 1, f'상세 {label} 항목이 여러 개라 입력하지 않습니다.')
            if not cells or not cells[0].text.strip():
                return False
        for selector in INPUTS.values():
            fields = [e for e in driver.find_elements('css selector', selector) if e.is_displayed()]
            require(len(fields) <= 1, '사용내역 입력란이 여러 개라 입력하지 않습니다.')
            if not fields or not fields[0].is_enabled() or fields[0].get_attribute('readonly'):
                return False
        return True
    except StaleElementReferenceException:
        return False


def wait_detail_ready(driver, timeout=20):
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.common.exceptions import TimeoutException
    try:
        WebDriverWait(driver, timeout, poll_frequency=0.2).until(detail_ready)
    except TimeoutException:
        raise SafetyStop('상세 거래 정보 또는 실사용자·인원수·목적 입력란이 준비되지 않았습니다. '
                         '입력란 잠금 여부와 상세화면 로딩 상태를 확인해주세요.') from None


def show_stop(message):
    """Expose safe failure reasons before the preserved browser-maintenance loop."""
    import tkinter as tk
    from tkinter import messagebox
    root = tk.Tk()
    root.withdraw()
    root.attributes('-topmost', True)
    try:
        messagebox.showerror('EAS 사용내역 입력 중단', message, parent=root)
    finally:
        root.destroy()


def report_stop(message, on_stop):
    print(message, file=sys.stderr)
    if on_stop:
        try:
            on_stop(message)
        except Exception:
            print('중단 안내 창을 표시하지 못했습니다. 콘솔의 중단 원인을 확인해주세요.', file=sys.stderr)


def confirm_desktop(title, message):
    import tkinter as tk
    from tkinter import messagebox
    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    try:
        return messagebox.askyesno(title, message, parent=root)
    finally:
        root.destroy()


def choose_file():
    import tkinter as tk
    from tkinter.filedialog import askopenfilename
    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    try:
        path = askopenfilename(parent=root, title="웹에서 내보낸 EAS 연결 파일 선택", filetypes=[("JSON", "*.json")])
    finally:
        root.destroy()
    require(path, "파일 선택을 취소했습니다.")
    return path


def connect(payload, baseline, confirm=confirm_desktop, on_stop=None):
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.common.action_chains import ActionChains
    from eas_assistant import verify_transaction

    validate_handoff(payload)
    require(payload["match"]["approvalNumber"], "승인번호가 없어 자동입력하지 않습니다.")
    driver = None
    stage = '기존 Edge·로그인·공지 처리'
    try:
        print("기존 기준 코드로 Edge를 실행합니다. 회사 로그인은 직접 해주세요.")
        driver = baseline_call(baseline.start_edge)
        require(driver is not None, "기준 코드의 Edge 실행이 실패했습니다.")
        require(baseline_call(baseline.open_sso_login, driver), "SSO 접속이 실패했습니다.")
        print("사용자 로그인 완료를 자동으로 기다립니다. PyCharm에서 Enter를 누르지 않아도 됩니다.")
        require(baseline_call(baseline.wait_for_login, driver), "로그인 완료 대기 실패입니다.")
        baseline.time.sleep(2)  # Same sequence/timing as the original main().
        require(baseline_call(baseline.open_eas_card_list, driver), "EAS 이동이 실패했습니다.")
        require(baseline_call(baseline.close_all_startup_notices, driver), "기준 코드가 공지를 모두 닫지 못했습니다.")
        baseline_call(baseline.show_final_status, driver)
        guard_screen(driver)

        def grid_ready(current):
            guard_screen(current)
            require(urlsplit(current.current_url).path == "/ep/cc/vouc/EpCcVouc0001", "EAS 사용내역 목록 화면이 아닙니다.")
            elements = [e for e in current.find_elements("css selector", GRID_SELECTOR) if e.is_displayed()]
            require(len(elements) <= 1, "사용내역 목록을 하나로 확정할 수 없습니다.")
            return bool(elements and elements[0].find_elements("css selector", "tr.IBDataRow"))

        WebDriverWait(driver, 20).until(grid_ready)
        stage = '목록 거래 대조'
        with elapsed_step('목록 거래 대조'):
            candidate = find_candidate(driver, payload)
        values = dict(candidate.values)
        require(confirm("EAS 거래 확인", (
            "현재 화면에 표시된 목록에서 후보 한 건을 찾았습니다.\n"
            f"일자: {values['receiptDate']}\n금액: {values['amount']:,}원\n"
            f"거래처: {values['merchantName']}\n카드 끝 4자리: {values['cardLast4']}\n업체등록: Y\n\n"
            "이 거래가 맞습니까? 예를 누르면 날짜 셀을 더블클릭해 상세를 엽니다.\n"
            "숨겨진 행·다른 페이지를 모두 검색한 결과는 아닙니다. 승인번호는 상세에서 추가 대조합니다."
        )), "사용자가 거래 열기를 취소했습니다.")
        with elapsed_step('확인 후 목록 재대조'):
            proof, date_cell = capture_registration(driver, payload, candidate)
        # Only this verified date cell is double-clicked, never 확인/전송/저장.
        with elapsed_step('상세 이동·입력란 준비'):
            ActionChains(driver).double_click(date_cell).perform()
            stage = '상세 거래 정보·입력란 로딩 대기'
            WebDriverWait(driver, 20, poll_frequency=0.2).until(lambda current: "/ep/cc/vouc/EpCcVouc0002" == urlsplit(current.current_url).path)
            wait_detail_ready(driver)
        validate_handoff(payload)
        stage = '상세 승인번호·일자·금액 대조'
        _, observed = read_detail(driver, payload, proof)
        verify_transaction(payload, observed)
        fields = payload["fields"]
        stage = '사용내역 입력 확인'
        require(confirm("실사용자·인원수·목적 입력 확인", (
            f"실사용자: {fields['employeeName']}\n인원수: {fields['attendeeCount']}명\n목적: {fields['purpose']}\n\n"
            "연결 파일이 최신인지 확인하세요. EAS의 비용구분·계정과목도 직접 확인하세요.\n"
            "예를 누르면 이 3개 입력란만 변경합니다. 기존 입력값은 대체됩니다.\n"
            "저장 버튼은 누르지 않으며 기존 영수증 상태·전표 O/X도 변경하지 않습니다."
        )), "사용자가 입력을 취소했습니다.")
        stage = '실사용자·인원수·목적 입력'
        wait_detail_ready(driver)
        validate_handoff(payload)
        with elapsed_step('3개 항목 입력·값 유지 검증'):
            fill_verified(driver, None, payload, context_reader=lambda: read_detail(driver, payload, proof))
        print("3개 입력란의 값 유지 확인 완료. React 검증 표시와 전체 거래를 직접 확인 후 직접 저장하세요.")
        return 0
    except SafetyStop as error:
        report_stop(f'중단 단계: {stage}\n{error}\n\n저장하지 않았습니다. 현재 EAS 화면을 유지합니다.', on_stop)
        return 1
    except KeyboardInterrupt:
        raise
    except Exception as error:
        report_stop(f'중단 단계: {stage}\n화면 또는 실행 환경 오류 ({type(error).__name__}).\n'
                    '일부 입력이 남았을 수 있으니 직접 확인하세요. 저장하지 않았습니다.', on_stop)
        return 1
    finally:
        if driver is not None:
            print("EAS 화면을 유지합니다. 일부 입력 후 오류가 났다면 화면을 직접 확인하세요. 종료는 브라우저 닫기 또는 PyCharm 정지 버튼입니다.")
            baseline_call(baseline.keep_browser_open, driver)


def run_connection(payload):
    try:
        # Importing the preserved file does not run its guarded main().
        baseline = importlib.import_module("eas_card_automation")
        return connect(payload, ResponsiveBaseline(baseline), on_stop=show_stop)
    except SafetyStop as error:
        print(f"중단: {error}", file=sys.stderr)
    except KeyboardInterrupt:
        print("사용자가 보조 프로그램을 중지했습니다.")
    except Exception as error:
        print(f"중단: 화면 또는 실행 환경 오류 ({type(error).__name__}). 자동입력·저장 성공으로 간주하지 마세요.", file=sys.stderr)
    return 1


def main():
    parser = argparse.ArgumentParser(description="검증된 기존 EAS 접속 코드 + 영수증 한 건 입력 연결 (저장 없음)")
    parser.add_argument("--receipt", help="영수증 웹에서 내보낸 JSON 경로. 없으면 파일 선택 창")
    parser.add_argument("--check", action="store_true", help="파일만 검사. Edge·EAS 접속 안 함")
    args = parser.parse_args()
    try:
        payload = validate_handoff(read_json(args.receipt or choose_file()))
        if args.check:
            print("연결 파일 검증 완료. Edge·EAS를 실행하지 않았습니다.")
            return 0
        return run_connection(payload)
    except SafetyStop as error:
        print(f"중단: {error}", file=sys.stderr)
    except Exception as error:
        print(f"중단: 파일 선택·읽기 오류 ({type(error).__name__}).", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
