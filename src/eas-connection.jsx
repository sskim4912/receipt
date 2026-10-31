import React, { useState } from 'react';
import { Modal, ErrorBox } from './ui.jsx';
import { createEasHandoff, createEasAppUrl, downloadEasHandoff } from './lib/eas-handoff.js';

export function EasConnection({ receipt, onClose }) {
  const [launchMessage, setLaunchMessage] = useState('');
  const [launchError, setLaunchError] = useState('');
  function openAssistant(event) {
    try {
      // Generate at the click, so the five-minute PC handoff is always fresh.
      const url = createEasAppUrl(receipt);
      // Let the user's native link activation open the registered application.
      // A separate target preserves the admin page if the browser blocks it.
      event.currentTarget.href = url;
      setLaunchError('');
      setLaunchMessage(
        '브라우저에서 프로그램 열기를 허용해주세요. 반응이 없으면 처음이라면 PC 자동 설치 파일을 내려받아 실행하세요.',
      );
    } catch (err) {
      event.preventDefault();
      setLaunchError(err.message);
    }
  }
  let payload, error, appUrl;
  try {
    payload = createEasHandoff(receipt);
    if (payload.match.approvalNumber) appUrl = createEasAppUrl(receipt);
  } catch (err) {
    error = err.message;
  }
  return (
    <Modal title="전자전표 연결" onClose={onClose} className="eas-dialog">
      <div className="eas-actions">
        <a className="button full" href="/downloads/AuroraEAS-Setup.cmd" download>
          처음 사용 · PC 자동 설치 다운로드
        </a>
        <p className="muted">
          다운로드한 파일을 실행하면 바탕화면에 설치 파일을 풀고 설정을 시작합니다.
        </p>
        {appUrl ? (
          <a
            className="button primary full"
            role="button"
            href={appUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={openAssistant}
            onKeyDown={(event) => {
              if (event.key === ' ') {
                event.preventDefault();
                event.currentTarget.click();
              }
            }}
          >
            EAS 보조 프로그램으로 연결
          </a>
        ) : (
          <button className="button primary full" disabled>
            EAS 보조 프로그램으로 연결
          </button>
        )}
        <div className="eas-download-links">
          <a href="/downloads/aurora-eas-windows.zip" download>
            ZIP 직접 다운로드
          </a>
          <a href="aurora-eas://check" target="_blank" rel="noopener noreferrer">
            PC 연결 상태 확인
          </a>
        </div>
      </div>
      <div className="eas-content">
        <ErrorBox message={error || launchError} />
        {payload && !payload.match.approvalNumber && (
          <p className="notice warning">
            승인번호가 없어 EAS 자동 연결을 진행할 수 없습니다. 승인번호를 먼저 확인해주세요.
          </p>
        )}
        {launchMessage && <p role="status">{launchMessage}</p>}
        <p className="eas-receipt-summary">
          <strong>{payload?.fields.employeeName || '확인 필요'}</strong>
          {' · '}
          {payload ? `${payload.fields.attendeeCount}명` : '인원 확인 필요'}
          <span>{payload?.fields.purpose || '목적 확인 필요'}</span>
        </p>
        <ol className="eas-steps">
          <li>처음에는 위 설치 파일을 받아 실행하세요. Python과 사내 기준 코드가 필요합니다.</li>
          <li>설치 후 연결 버튼을 누르고 브라우저의 프로그램 열기를 허용하세요.</li>
          <li>
            최초·세션 만료 시 Edge에서 로그인하고 거래와 입력 내용을 확인하세요. 저장은 직접 합니다.
          </li>
        </ol>
        <details>
          <summary>최초 1회 PC 설정 · 연결 도움말</summary>
          <p>
            Windows PC용입니다. 브라우저가 자동으로 설치하거나 다운로드한 파일을 실행할 수는
            없습니다. 자동 설치 파일을 직접 실행하면 바탕화면에 압축을 풀고 설치를 시작합니다.
            설치가 끝나면 바탕화면에 업무 포탈과 PC 연결 확인 바로가기를 만듭니다.
          </p>
          <p>
            Python이 없거나 검증된 eas_card_automation.py를 찾지 못하면 설치를 완료할 수 없습니다.
            Python 설치는 사내 담당자에게 요청하고, 기준 코드는 최초 한 번 선택해주세요. 회사 기준
            코드는 공개 다운로드에 포함하지 않습니다.
          </p>
          <p>
            CMD 다운로드가 회사 정책으로 차단되면 ZIP 직접 다운로드를 이용하세요. 전체 압축을 풀고
            INSTALL.cmd를 실행하면 됩니다. 기존 설치 사용자도 새 버전 설치를 한 번 실행해주세요.
            다른 영수증을 연결하기 전 이전 EAS Edge 창을 닫아주세요.
          </p>
          <p>
            PC 연결 상태 확인은 등록 여부만 확인합니다. 회사 로그인·EAS 접속 성공을 확인하는 기능은
            아닙니다. 후보 한 건의 승인번호·일자·금액을 대조하고 비용구분·계정과목과 기존 처리상태는
            변경하지 않습니다.
          </p>
          <button
            className="button"
            disabled={!payload}
            onClick={() => downloadEasHandoff(payload)}
          >
            EAS 연결 파일 다운로드
          </button>
        </details>
      </div>
    </Modal>
  );
}
