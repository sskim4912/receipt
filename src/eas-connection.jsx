import React, { useRef, useState } from 'react';
import { Modal, ErrorBox } from './ui.jsx';
import { createEasHandoff, createEasAppUrl, downloadEasHandoff } from './lib/eas-handoff.js';

export function EasConnection({ receipt, onClose }) {
  const [launchMessage, setLaunchMessage] = useState('');
  const [launchError, setLaunchError] = useState('');
  const launcher = useRef(null);
  function openAssistant() {
    try {
      // Generate at the click, so the five-minute PC handoff is always fresh.
      const url = createEasAppUrl(receipt);
      // Keep the admin screen even if this PC blocks external applications.
      launcher.current.src = url;
      setLaunchError('');
      setLaunchMessage(
        '브라우저에서 프로그램 열기를 허용해주세요. 반응이 없으면 아래 최초 1회 PC 설정을 진행하세요.',
      );
    } catch (err) {
      setLaunchError(err.message);
    }
  }
  let payload, error;
  try {
    payload = createEasHandoff(receipt);
  } catch (err) {
    error = err.message;
  }
  return (
    <Modal title="전자전표 연결" onClose={onClose}>
      <p>이 영수증 한 건을 Windows 전자전표 보조 프로그램에 전달합니다.</p>
      <dl className="core-summary">
        <div>
          <dt>실사용자</dt>
          <dd>{payload?.fields.employeeName || '확인 필요'}</dd>
        </div>
        <div>
          <dt>인원수</dt>
          <dd>{payload ? `${payload.fields.attendeeCount}명` : '확인 필요'}</dd>
        </div>
        <div>
          <dt>목적</dt>
          <dd>{payload?.fields.purpose || '확인 필요'}</dd>
        </div>
      </dl>
      <ErrorBox message={error} />
      {payload && !payload.match.approvalNumber && (
        <p className="notice warning">
          승인번호가 없어 EAS 자동 연결을 진행할 수 없습니다. 승인번호를 먼저 확인해주세요.
        </p>
      )}
      <ol>
        <li>최초 1회 PC 설정 후, 아래 연결 버튼을 누르고 프로그램 열기를 허용합니다.</li>
        <li>보조 프로그램이 연 Edge에서 직접 로그인합니다. 로그인 완료는 자동 감지합니다.</li>
        <li>
          거래 후보와 입력 내용을 확인 창에서 승인하면 3개 항목만 입력합니다. 저장은 직접 합니다.
        </li>
      </ol>
      <p className="muted">
        Windows PC에서 사용합니다. 현재 로드된 EAS 목록에서 후보 한 건을 확인하고 상세
        승인번호·일자·금액을 대조합니다. 후보가 없거나 여러 개면 중단합니다. 비용구분·계정과목과
        기존 처리상태는 변경하지 않습니다.
      </p>
      <ErrorBox message={launchError} />
      <iframe ref={launcher} title="EAS PC 프로그램 연결" hidden />
      {launchMessage && <p role="status">{launchMessage}</p>}
      <button
        className="button primary full"
        disabled={!payload?.match.approvalNumber}
        onClick={openAssistant}
      >
        EAS 보조 프로그램으로 연결
      </button>
      <details>
        <summary>최초 1회 PC 설정 · 연결 도움말</summary>
        <p>
          업무용 Windows PC에서 아래 설치 파일의 압축을 풀고 INSTALL.cmd를 실행하세요. 기존에 정상
          작동한 eas_card_automation.py를 선택합니다. 이후에는 연결 파일을 내려받거나 선택할 필요가
          없습니다. 다른 영수증을 연결할 때는 이전 연결로 열린 Edge 창을 먼저 닫아주세요.
        </p>
        <a className="button" href="./downloads/aurora-eas-windows.zip" download>
          PC 연결 설치 파일 다운로드
        </a>
        <p className="muted">
          회사 PC 정책에 따라 프로그램 연결 등록이 제한될 수 있습니다. 이때는 기존 파일 방식으로
          사용할 수 있습니다. 전달 내용은 PC에서 거래 대조 후 직접 승인합니다.
        </p>
        <button className="button" disabled={!payload} onClick={() => downloadEasHandoff(payload)}>
          EAS 연결 파일 다운로드
        </button>
      </details>
    </Modal>
  );
}
