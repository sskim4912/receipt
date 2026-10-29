import React from 'react';
import { Modal, ErrorBox } from './ui.jsx';
import { createEasHandoff, downloadEasHandoff } from './lib/eas-handoff.js';

export function EasConnection({ receipt, onClose }) {
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
          승인번호가 없어 1차 버전의 EAS 자동입력은 중단됩니다. 내보내기는 가능합니다.
        </p>
      )}
      <ol>
        <li>연결 파일을 내려받고 Windows 보조 프로그램에서 선택합니다.</li>
        <li>보조 프로그램이 연 Edge에서 직접 로그인합니다. 로그인 완료는 자동 감지합니다.</li>
        <li>
          거래 후보와 입력 내용을 확인 창에서 승인하면 3개 항목만 입력합니다. 저장은 직접 합니다.
        </li>
      </ol>
      <p className="muted">
        웹 버튼만으로 Windows 프로그램이 실행되지는 않습니다. 현재 로드된 EAS 목록에서 후보 한 건을
        확인하고 상세 승인번호·일자·금액을 대조합니다. 후보가 없거나 여러 개면 중단합니다.
        비용구분·계정과목과 기존 처리상태는 변경하지 않습니다.
      </p>
      <p className="muted">
        파일에 사용자 이름과 사용내역이 포함됩니다. 업무용 PC에서만 보관하고 사용 후 정리해주세요.
      </p>
      <button
        className="button primary full"
        disabled={!payload}
        onClick={() => downloadEasHandoff(payload)}
      >
        EAS 연결 파일 다운로드
      </button>
    </Modal>
  );
}
