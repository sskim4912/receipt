import React, { useState } from 'react';
import { Modal, ErrorBox, Icon } from './ui.jsx';
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
        '브라우저에서 프로그램 열기를 허용해주세요. 처음 사용하는 PC라면 설치 파일을 내려받아 실행하세요.',
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
      <dl className="eas-receipt-summary" aria-label="연결할 영수증">
        <div>
          <dt>사용일자</dt>
          <dd>{receipt.receiptDate?.replaceAll('-', '.') || '확인 필요'}</dd>
        </div>
        <div>
          <dt>업체명</dt>
          <dd>{receipt.merchantName || '확인 필요'}</dd>
        </div>
        <div>
          <dt>금액</dt>
          <dd>
            {Number.isFinite(receipt.amount)
              ? `${receipt.amount.toLocaleString('ko-KR')}원`
              : '확인 필요'}
          </dd>
        </div>
      </dl>
      <div className="eas-actions">
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
        <p className="muted eas-launch-hint">설치한 PC에서는 바로 연결하세요.</p>
        <p className="eas-first-label">처음 사용하는 PC인가요?</p>
        <a className="button full" href="/downloads/AuroraEAS-Setup.cmd" download>
          <Icon name="download" size={20} /> PC 자동 설치 다운로드
        </a>
      </div>
      <div className="eas-content">
        <ErrorBox message={error || launchError} />
        {payload && !payload.match.approvalNumber && (
          <p className="notice warning">
            승인번호가 없어 EAS 자동 연결을 진행할 수 없습니다. 승인번호를 먼저 확인해주세요.
          </p>
        )}
        {launchMessage && <p role="status">{launchMessage}</p>}
        <h3 className="eas-guide-title">처음 한 번, 간편하게 시작하기</h3>
        <ol className="eas-steps">
          <li>
            <span className="eas-step-icon">
              <Icon name="download" />
            </span>
            <div>
              <strong>1. 설치 파일 다운로드</strong>
              <p>처음 사용하는 PC에서는 ‘PC 자동 설치 다운로드’를 눌러 파일을 받으세요.</p>
            </div>
          </li>
          <li>
            <span className="eas-step-icon">
              <Icon name="check" />
            </span>
            <div>
              <strong>2. 다운로드한 파일 실행</strong>
              <p>
                <code>AuroraEAS-Setup.cmd</code>를 실행하고 설치 안내를 따라주세요. ZIP 다운로드와
                압축 해제, 설치 시작은 자동으로 진행됩니다.
              </p>
            </div>
          </li>
          <li>
            <span className="eas-step-icon">
              <Icon name="arrow" />
            </span>
            <div>
              <strong>3. 다음부터는 바로 접속</strong>
              <p>
                설치 완료 후에는 ‘EAS 보조 프로그램으로 연결’만 누르면 GS건설 EIP 화면으로
                접속됩니다.
              </p>
              <p className="muted">
                로그인이 만료된 경우에는 다시 로그인해주세요. 저장은 직접 합니다.
              </p>
            </div>
          </li>
        </ol>
        <details>
          <summary>설치·연결이 안 될 때</summary>
          <div className="eas-download-links">
            <a href="/downloads/aurora-eas-windows.zip" download>
              ZIP 직접 다운로드
            </a>
            <a href="aurora-eas://check" target="_blank" rel="noopener noreferrer">
              PC 연결 상태 확인
            </a>
          </div>
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
