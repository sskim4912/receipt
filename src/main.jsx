import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { firebaseConfig } from './firebase-config.js';
import { FirestoreRest } from './lib/firestore-rest.js';
import { ReceiptRepository } from './lib/repository.js';
import { inspectPhoto } from './lib/photo.js';
import { recognizeReceipt } from './lib/cloud-vision.js';
import {
  STATUSES,
  METHODS,
  CATEGORIES,
  LABELS,
  EMPTY_CORE,
  EMPTY_EXTRAS,
  validateInput,
  inputError,
  money,
  display,
  toForm,
  filterReceipts,
  csv,
} from './lib/domain.js';
import { makeGate, verifyGate } from './lib/admin-gate.js';
import { Icon, Modal, Field, ErrorBox } from './ui.jsx';
import gsLogo from './assets/gs-construction-logo.png';
import './styles.css';
const repo = new ReceiptRepository(new FirestoreRest(firebaseConfig));
const statusKeys = Object.keys(STATUSES);
function Badge({ status }) {
  return (
    <span className={`badge status-${statusKeys.indexOf(status)}`}>
      {STATUSES[status] || '확인필요'}
    </span>
  );
}
function formatAmountInput(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
function Summary({ core, extras }) {
  return (
    <dl className="core-summary">
      {['merchantName', 'receiptDate', 'amount'].map((k) => (
        <div key={k}>
          <dt>{LABELS[k]}</dt>
          <dd>{k === 'amount' ? money(core.amount) : core[k] || '확인불가'}</dd>
        </div>
      ))}
      {extras &&
        ['employeeName', 'attendeeCount', 'purpose', 'location'].map((k) => (
          <div key={k}>
            <dt>{LABELS[k]}</dt>
            <dd>{extras[k] || '확인불가'}</dd>
          </div>
        ))}
    </dl>
  );
}
function CoreFields({ value, onChange, team = false, simple = false }) {
  const amountInput = useRef(null);
  const set = (k, v) => onChange({ ...value, [k]: v });
  function setFormattedAmount(input) {
    const cursor = input.selectionStart ?? input.value.length;
    const digitsBeforeCursor = input.value.slice(0, cursor).replace(/\D/g, '').length;
    const digits = input.value.replace(/\D/g, '');
    const formatted = formatAmountInput(digits);
    set('amount', digits);
    requestAnimationFrame(() => {
      let position = 0;
      let digitCount = 0;
      while (position < formatted.length && digitCount < digitsBeforeCursor) {
        if (/\d/.test(formatted[position])) digitCount += 1;
        position += 1;
      }
      amountInput.current?.setSelectionRange(position, position);
    });
  }
  const keys = simple
    ? ['merchantName', 'amount', 'receiptDate']
    : ['merchantName', 'businessNumber', 'receiptDate', 'amount', 'approvalNumber'];
  return (
    <>
      <div className="form-grid">
        {keys.map((k) => (
          <Field
            key={k}
            label={LABELS[k]}
            required={
              !team &&
              (simple
                ? ['merchantName', 'amount', 'receiptDate'].includes(k)
                : !['businessNumber', 'approvalNumber'].includes(k))
            }
            hint={
              k === 'businessNumber'
                ? '영수증에 없으면 비워두세요.'
                : k === 'approvalNumber'
                  ? '자동 인식되며, 읽히지 않아도 등록 가능합니다.'
                  : undefined
            }
          >
            <input
              ref={k === 'amount' ? amountInput : undefined}
              name={k}
              aria-label={k === 'approvalNumber' ? '승인번호' : LABELS[k]}
              type={k === 'receiptDate' ? 'date' : 'text'}
              inputMode={['amount', 'approvalNumber'].includes(k) ? 'numeric' : undefined}
              value={k === 'amount' ? formatAmountInput(value[k]) : value[k]}
              required={
                !team &&
                (simple
                  ? ['merchantName', 'amount', 'receiptDate'].includes(k)
                  : !['businessNumber', 'approvalNumber'].includes(k))
              }
              disabled={
                k === 'approvalNumber' &&
                (team ? value.approvalState !== 'present' : value.approvalState === 'absent')
              }
              maxLength={k === 'merchantName' ? 160 : k === 'approvalNumber' ? 40 : undefined}
              pattern={k === 'amount' ? '[0-9,]+' : undefined}
              onChange={(e) => {
                const next = e.target.value;
                if (k === 'approvalNumber')
                  onChange({
                    ...value,
                    approvalNumber: next,
                    approvalState: next ? 'present' : 'unreadable',
                  });
                else if (k === 'amount') setFormattedAmount(e.currentTarget);
                else set(k, next);
              }}
            />
          </Field>
        ))}
      </div>
      {!simple && (
        <>
          {team ? (
            <label className="field">
              <span>승인번호 상태</span>
              <select
                aria-label="승인번호 상태"
                value={value.approvalState}
                onChange={(e) =>
                  onChange({
                    ...value,
                    approvalState: e.target.value,
                    approvalNumber: e.target.value === 'present' ? value.approvalNumber : '',
                  })
                }
              >
                <option value="unreadable">확인불가</option>
                <option value="present">승인번호 있음 (직접 입력)</option>
                <option value="absent">영수증에 승인번호 자체가 없음</option>
              </select>
            </label>
          ) : (
            <label className="checkbox">
              <input
                type="checkbox"
                checked={value.approvalState === 'absent'}
                onChange={(e) =>
                  onChange({
                    ...value,
                    approvalState: e.target.checked ? 'absent' : 'unreadable',
                    approvalNumber: '',
                  })
                }
              />
              영수증에 승인번호 자체가 없습니다.
            </label>
          )}
          {!team && (
            <p className="muted">
              승인번호는 자동으로 읽히면 입력됩니다. 읽히지 않거나 영수증에 없으면 비워둘 수
              있습니다.
            </p>
          )}
          {team && (
            <p className="muted">
              읽을 수 없는 값은 비워두세요. 승인번호가 흐려서 읽지 못한 경우에는 ‘없음’을 선택하지
              마세요.
            </p>
          )}
          <details className="optional-fields">
            <summary>추가 영수증 정보 (선택)</summary>
            <div className="form-grid two-column">
              <Field label="분류">
                <select
                  aria-label="분류"
                  value={value.category}
                  onChange={(e) => set('category', e.target.value)}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </Field>
              {['paymentMethod', 'supplyAmount', 'vatAmount', 'cardLast4', 'items'].map((k) => (
                <label className="field" key={k}>
                  <span>{LABELS[k]}</span>
                  <input
                    aria-label={LABELS[k]}
                    type={k === 'receiptTime' ? 'time' : 'text'}
                    value={value[k]}
                    inputMode={
                      ['supplyAmount', 'vatAmount', 'cardLast4'].includes(k) ? 'numeric' : undefined
                    }
                    maxLength={k === 'cardLast4' ? 4 : k === 'items' ? 1000 : 160}
                    placeholder={k === 'cardLast4' ? '마지막 4자리만 입력' : undefined}
                    onChange={(e) => set(k, e.target.value)}
                  />
                </label>
              ))}
            </div>
          </details>
        </>
      )}
    </>
  );
}
function ExtraFields({ value, onChange, includeMemo = false }) {
  const set = (k, v) => onChange({ ...value, [k]: v });
  return (
    <>
      <div className="form-grid">
        <Field label="실제 사용자(당사 임직원)" requiredTone="danger">
          <input
            name="employeeName"
            aria-label="실제 사용자"
            value={value.employeeName}
            placeholder="예) 김성석"
            required
            maxLength={160}
            onChange={(e) => set('employeeName', e.target.value)}
          />
        </Field>
        <Field
          label="참석 인원수"
          requiredTone="danger"
          hint={
            value.attendeeCount && !/^(?:[1-9]|[1-9]\d)$/.test(value.attendeeCount)
              ? '참석 인원수는 1~99 사이의 숫자만 입력해주세요.'
              : '1~99명 · 숫자만 입력'
          }
        >
          <input
            name="attendeeCount"
            aria-label="참석 인원수"
            inputMode="numeric"
            pattern="[1-9][0-9]?"
            aria-invalid={!!value.attendeeCount && !/^(?:[1-9]|[1-9]\d)$/.test(value.attendeeCount)}
            value={value.attendeeCount}
            placeholder="예) 1"
            required
            maxLength={8}
            onChange={(e) => set('attendeeCount', e.target.value)}
          />
        </Field>
        <Field label="구체적인 사용 목적" requiredTone="danger">
          <input
            name="purpose"
            aria-label="구체적인 사용 목적"
            value={value.purpose}
            placeholder="예) 관리팀 회식"
            required
            maxLength={1000}
            onChange={(e) => set('purpose', e.target.value)}
          />
        </Field>
        <Field label="사용장소" requiredTone="danger">
          <input
            name="location"
            aria-label="사용장소"
            value={value.location}
            placeholder="예) 대산읍"
            required
            maxLength={160}
            onChange={(e) => set('location', e.target.value)}
          />
        </Field>
        <label className="field">
          <span>사번 (선택)</span>
          <input
            aria-label="사번"
            value={value.employeeId}
            maxLength={40}
            placeholder="동명이인 구분이 필요하면 입력"
            onChange={(e) => set('employeeId', e.target.value)}
          />
        </label>
        {includeMemo && (
          <label className="field">
            <span>메모 (선택)</span>
            <textarea
              aria-label="메모"
              value={value.memo}
              maxLength={1000}
              onChange={(e) => set('memo', e.target.value)}
            />
          </label>
        )}
      </div>
    </>
  );
}
function PhotoCapture({ photo, camera, onChange, onError, ocrMessage }) {
  const [large, setLarge] = useState(false);
  return (
    <div className="photo-panel">
      {photo ? (
        <button
          className="preview-button"
          onClick={() => setLarge(true)}
          aria-label="현재 사진 확대"
          type="button"
        >
          <img
            className="receipt-photo"
            src={photo.url}
            alt="브라우저에서 임시로 확인 중인 영수증"
          />
        </button>
      ) : null}
      <input
        ref={camera}
        className="visually-hidden"
        type="file"
        accept="image/*"
        capture="environment"
        aria-label="영수증 사진 촬영"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          try {
            onChange(await inspectPhoto(file));
          } catch (error) {
            onError(error.message);
          }
        }}
      />
      <button
        className="button secondary full photo-capture-button"
        type="button"
        onClick={() => camera.current?.click()}
      >
        <Icon name="camera" size={19} />
        {photo ? '다시 촬영' : '영수증 사진 촬영 버튼'}
      </button>
      {ocrMessage && (
        <p className="ocr-status" role="status">
          {ocrMessage}
        </p>
      )}
      {large && (
        <Modal title="현재 영수증 사진" wide onClose={() => setLarge(false)}>
          <img className="modal-image" src={photo.url} alt="현재 영수증 확대" />
        </Modal>
      )}
    </div>
  );
}
function App() {
  const [screen, setScreen] = useState('manual'),
    [login, setLogin] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [core, setCore] = useState({ ...EMPTY_CORE }),
    [extras, setExtras] = useState({ ...EMPTY_EXTRAS }),
    [photo, setPhoto] = useState(null),
    [ocrMessage, setOcrMessage] = useState(''),
    [saved, setSaved] = useState(null),
    [deleteDraft, setDeleteDraft] = useState(false);
  const camera = useRef(),
    lock = useRef(false),
    ocrRequest = useRef(null),
    requestId = useRef(crypto.randomUUID());
  useEffect(
    () => () => {
      if (photo) URL.revokeObjectURL(photo.url);
    },
    [photo],
  );
  useEffect(() => () => ocrRequest.current?.abort(), []);
  function reset() {
    ocrRequest.current?.abort();
    ocrRequest.current = null;
    setScreen('manual');
    setPhoto(null);
    setOcrMessage('');
    setCore({ ...EMPTY_CORE });
    setExtras({ ...EMPTY_EXTRAS });
    setError('');
    setSaved(null);
    requestId.current = crypto.randomUUID();
  }
  async function handlePhoto(value) {
    ocrRequest.current?.abort();
    setPhoto(value);
    setError('');
    const controller = new AbortController();
    ocrRequest.current = controller;
    setOcrMessage('영수증을 읽는 중입니다…');
    try {
      const recognized = await recognizeReceipt(value.file, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      const extracted = Object.entries(recognized).filter(([, v]) => v);
      const { location, ...coreValues } = recognized;
      setCore((current) => ({
        ...current,
        ...Object.fromEntries(
          Object.entries(coreValues).filter(([key, value]) => value && !current[key]),
        ),
      }));
      if (location)
        setExtras((current) => ({ ...current, location: current.location || location }));
      setOcrMessage(
        extracted.length
          ? `인식된 ${extracted.length}개 항목을 빈 입력란에 넣었습니다. 원본과 대조해 확인해주세요.`
          : '읽을 수 있는 항목을 찾지 못했습니다. 이상한 값은 넣지 않았으니 직접 입력해주세요.',
      );
    } catch (err) {
      if (!controller.signal.aborted) {
        setOcrMessage(
          `영수증 판독에 실패했습니다. 사진을 확인하며 직접 입력해주세요. (${err.message})`,
        );
      }
    }
  }
  function navigate(next) {
    if (busy) return;
    if (
      Object.values(core).some((v, i) => v && v !== Object.values(EMPTY_CORE)[i]) ||
      Object.values(extras).some(Boolean)
    ) {
      setDeleteDraft(next);
      return;
    }
    setScreen(next);
    setError('');
  }
  function focusEntryField(name) {
    if (!name) return;
    requestAnimationFrame(() => {
      const field = document.querySelector(`[name="${name}"]`);
      if (!field) return;
      field.scrollIntoView({ behavior: 'smooth', block: 'center' });
      field.focus({ preventScroll: true });
    });
  }
  function confirm(e) {
    e.preventDefault();
    const requiredEntries = [
      { name: 'merchantName', label: '업체명', value: core.merchantName },
      { name: 'amount', label: '영수금액', value: core.amount },
      { name: 'receiptDate', label: '사용일자', value: core.receiptDate },
      { name: 'employeeName', label: '실제 사용자(당사 임직원)', value: extras.employeeName },
      { name: 'attendeeCount', label: '참석 인원수', value: extras.attendeeCount },
      { name: 'purpose', label: '구체적인 사용 목적', value: extras.purpose },
      { name: 'location', label: '사용장소', value: extras.location },
    ];
    const missing = requiredEntries.find(({ value }) => !String(value || '').trim());
    if (missing) {
      setError(`${missing.label}을(를) 입력해주세요.`);
      focusEntryField(missing.name);
      return;
    }
    try {
      validateInput(core, extras);
      setError('');
      setScreen('confirm');
    } catch (err) {
      setError(inputError(err));
      const issueField = err?.issues?.find((issue) => issue.path?.length)?.path?.[0];
      focusEntryField(issueField || (String(err.message).includes('영수금액') ? 'amount' : ''));
    }
  }
  let valid = false;
  try {
    validateInput(core, extras);
    valid = true;
  } catch {}
  async function register(e) {
    e.preventDefault();
    if (lock.current || !valid) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const receipt = await repo.create(requestId.current, core, extras);
      if (!receipt)
        throw new Error('저장 결과를 확인할 수 없습니다. 입력내용을 유지한 채 다시 시도해주세요.');
      setSaved(receipt);
      setPhoto(null);
      setScreen('success');
    } catch (err) {
      setError(inputError(err));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const step = screen === 'manual' ? 0 : screen === 'confirm' ? 1 : 2;
  return (
    <>
      <header className="site-header">
        <button
          className="brand brand-button"
          onClick={() => window.location.reload()}
          aria-label="페이지 새로고침"
        >
          <img className="gs-logo" src={gsLogo} alt="GS건설" />
        </button>
        <div className="header-actions">
          <button
            className="admin-link"
            disabled={busy}
            onClick={() => {
              if (screen === 'admin') return;
              setLogin(true);
            }}
          >
            <Icon name="shield" size={17} />
            관리자 접속
          </button>
          <button
            className="my-receipts-link"
            disabled={busy}
            onClick={() => navigate('history')}
          >
            <Icon name="receipt" size={17} />
            본인 등록 내용 확인
          </button>
        </div>
      </header>
      {!['admin', 'history'].includes(screen) && (
        <div className="project-banner">
          <strong>Aurora Project 영수증 등록</strong>
          <span>영수증을 확인하고 사용내역을 간편하게 기록하세요.</span>
        </div>
      )}
      {screen === 'admin' ? (
        <Admin
          onBack={() => {
            reset();
          }}
        />
      ) : screen === 'history' ? (
        <History onBack={reset} />
      ) : (
        <main className="registration">
          <h2 className="process-title">처리 절차</h2>
          <ol className="steps" aria-label="등록 단계">
            {['영수증 사진 촬영', '필수 입력 요청 사항', '입력 확인 및 전송'].map((s, i) => (
              <li
                key={s}
                className={i === step ? 'active' : i < step ? 'complete' : ''}
                aria-current={i === step ? 'step' : undefined}
              >
                <span>{i < step ? <Icon name="check" size={13} /> : i + 1}</span>
                {s}
              </li>
            ))}
          </ol>
          <ErrorBox message={error} />
          {screen === 'manual' && (
            <section className="card">
              <div className="section-heading">
                <span className="section-number">1</span>
                <div>
                  <h2>영수증 사진 촬영</h2>
                  <p>
                    <span className="photo-instruction-line">선명하게, 크게 사진을 찍어주세요.</span>
                    <span className="photo-instruction-line">
                      사진을 촬영하면 주요 정보가 입력됩니다.
                    </span>
                  </p>
                </div>
              </div>
              <form onSubmit={confirm} noValidate>
                <PhotoCapture
                  photo={photo}
                  camera={camera}
                  onChange={handlePhoto}
                  onError={setError}
                  ocrMessage={ocrMessage}
                />
                <CoreFields value={core} onChange={setCore} simple />
                <div className="section-heading section-heading-required">
                  <span className="section-number">2</span>
                  <div>
                    <h2>필수 입력 요청 사항</h2>
                  </div>
                </div>
                <ExtraFields value={extras} onChange={setExtras} />
                <ErrorBox message={error} />
                <button className="button primary full" disabled={busy}>
                  입력내용 확인 및 전송
                </button>
              </form>
            </section>
          )}
          {screen === 'confirm' && (
            <section className="card compact">
              <h2>등록 내용을 확인해주세요.</h2>
              <PhotoCapture
                photo={photo}
                camera={camera}
                onChange={handlePhoto}
                onError={setError}
                ocrMessage={ocrMessage}
              />
              <Summary
                core={{ ...core, amount: core.amount ? Number(core.amount) : null }}
                extras={extras}
              />
              <div className="notice">정보가 맞으면 등록을 진행해주세요.</div>
              <form onSubmit={register}>
                <ErrorBox message={error} />
                <button className="button primary full" disabled={!valid || busy}>
                  {busy ? '등록 중...' : '등록하기'}
                </button>
                <button
                  type="button"
                  className="button secondary full"
                  disabled={busy}
                  onClick={() => setScreen('manual')}
                >
                  수정
                </button>
              </form>
            </section>
          )}
          {screen === 'success' && (
            <section className="card success-card">
              <div className="success-icon">
                <Icon name="check" size={38} />
              </div>
              <h2>영수증이 등록되었습니다.</h2>
              <p>
                입력한 사용내역이 저장되었습니다.
                <br />
                영수증 원본은 별도로 보관해주세요.
              </p>
              <Badge status={saved.status} />
              <p className="receipt-id">등록번호: {saved.receiptId}</p>
              {saved.suspectedDuplicate && (
                <div className="notice warning">
                  비슷한 영수증이 있어 관리팀이 중복 여부를 확인합니다.
                </div>
              )}
              <button className="button primary" onClick={reset}>
                새 영수증 등록
              </button>
              <button
                className="button secondary"
                onClick={() => {
                  reset();
                  setScreen('history');
                }}
              >
                처리상태 조회
              </button>
            </section>
          )}
        </main>
      )}
      <footer>
        Vision : 투명한 신뢰와 끊임없는 혁신으로 더 안전하고 행복한 삶의 미래를 완성합니다.
      </footer>
      {login && (
        <Login
          onClose={() => setLogin(false)}
          onSuccess={() => {
            setLogin(false);
            ocrRequest.current?.abort();
            setPhoto(null);
            setOcrMessage('');
            setScreen('admin');
            setError('');
          }}
        />
      )}
      {deleteDraft && (
        <Modal title="화면 이동" onClose={() => setDeleteDraft(false)}>
          <p>이동하면 입력 중인 내용이 사라집니다. 이동하시겠습니까?</p>
          <div className="modal-actions">
            <button className="button secondary" onClick={() => setDeleteDraft(false)}>
              취소
            </button>
            <button
              className="button primary"
              onClick={() => {
                const target = deleteDraft;
                reset();
                setScreen(target);
                setDeleteDraft(false);
              }}
            >
              이동
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
function Login({ onClose, onSuccess }) {
  const [gate, setGate] = useState(undefined),
    [password, setPassword] = useState(''),
    [repeat, setRepeat] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const lock = useRef(false);
  useEffect(() => {
    let active = true;
    repo
      .gate()
      .then((v) => active && setGate(v))
      .catch((e) => active && setError(inputError(e)));
    return () => {
      active = false;
    };
  }, []);
  async function submit(e) {
    e.preventDefault();
    if (lock.current || gate === undefined) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      if (gate === null) {
        if (password !== repeat) throw new Error('비밀번호 확인이 일치하지 않습니다.');
        await repo.setupGate(await makeGate(password));
      } else if (!(await verifyGate(password, gate)))
        throw new Error('관리자 비밀번호가 올바르지 않습니다.');
      onSuccess();
    } catch (e) {
      setError(inputError(e));
      if (gate === null)
        repo
          .gate()
          .then(setGate)
          .catch(() => {});
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal title="관리자 접속" onClose={() => !busy && onClose()}>
      <div className="notice warning">
        테스트용 화면 잠금입니다. 공개 Firestore 규칙에서는 데이터 접근을 보호하지 않습니다.
      </div>
      {gate === undefined && !error && <p role="status">설정 확인 중...</p>}
      {gate === null && (
        <p className="muted">
          첫 관리자 접속입니다. 사용할 공용 비밀번호를 설정해주세요. 다른 기기에서도 이 비밀번호로
          화면을 열 수 있습니다.
        </p>
      )}
      <form onSubmit={submit}>
        <Field label="관리자 비밀번호">
          <input
            aria-label="관리자 비밀번호"
            type="password"
            autoComplete={gate === null ? 'new-password' : 'current-password'}
            required
            minLength={gate === null ? 12 : 1}
            maxLength={128}
            disabled={gate === undefined || busy}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        {gate === null && (
          <Field label="비밀번호 확인">
            <input
              aria-label="비밀번호 확인"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={128}
              value={repeat}
              onChange={(e) => setRepeat(e.target.value)}
            />
          </Field>
        )}
        <ErrorBox message={error} />
        <button className="button primary full" disabled={busy || gate === undefined || !password}>
          {busy ? '확인 중...' : gate === null ? '비밀번호 설정 / 관리자 접속' : '확인'}
        </button>
      </form>
    </Modal>
  );
}
function Detail({ r }) {
  return (
    <>
      <dl className="detail-grid">
        {Object.keys(LABELS)
          .filter((k) => k !== 'receiptTime')
          .map((k) => (
            <div key={k}>
              <dt>{LABELS[k]}</dt>
              <dd>
                {k === 'receiptDate'
                  ? [r.receiptDate, r.receiptTime].filter(Boolean).join(' ') || '—'
                  : display(r, k) || '—'}
              </dd>
            </div>
          ))}
      </dl>
      <p className="file-label">등록번호: {r.receiptId}</p>
      <div className="notice">
        직접 입력한 내용은 원본 영수증과 대조해주세요.
      </div>
      {r.suspectedDuplicate && (
        <p className="duplicate-note">중복 의심: 동일 사용처·일자·금액의 내역을 확인해주세요.</p>
      )}
    </>
  );
}
function History({ onBack }) {
  const [name, setName] = useState(''),
    [id, setId] = useState(''),
    [rows, setRows] = useState([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [expanded, setExpanded] = useState(null),
    [searched, setSearched] = useState(false);
  async function search(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      setRows(await repo.byEmployee(name, id));
      setSearched(true);
    } catch (e) {
      setError(inputError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="registration">
      <div className="page-intro">
        <span className="eyebrow">직원 화면</span>
        <h1>처리상태 조회</h1>
        <p>사용자 이름으로 현재 상태를 확인하세요. 동명이인은 사번으로 구분할 수 있습니다.</p>
      </div>
      <section className="card history-card">
        <form onSubmit={search}>
          <label className="field">
            <span>사용자 이름</span>
            <input
              aria-label="조회할 사용자 이름"
              value={name}
              required
              maxLength={160}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="field">
            <span>사번 (선택)</span>
            <input
              aria-label="조회할 사번"
              value={id}
              maxLength={40}
              onChange={(e) => setId(e.target.value)}
            />
          </label>
          <button className="button primary full" disabled={busy}>
            {busy ? '조회 중...' : '조회'}
          </button>
        </form>
        <ErrorBox message={error} />
        {searched && rows.length === 0 && (
          <div className="empty-state">해당 등록내역이 없습니다.</div>
        )}
        {rows.map((r) => (
          <article className="history-row" key={r.receiptId}>
            <button
              className="history-open"
              aria-expanded={expanded === r.receiptId}
              onClick={() => setExpanded(expanded === r.receiptId ? null : r.receiptId)}
            >
              <div>
                <strong>{r.merchantName || '관리팀 확인 요청'}</strong>
                <p>
                  {r.receiptDate || '날짜 확인필요'} · {r.employeeName} · {money(r.amount)}
                </p>
              </div>
              <Badge status={r.status} />
            </button>
            {expanded === r.receiptId && <Detail r={r} />}
          </article>
        ))}
        <button className="button text full" disabled={busy} onClick={onBack}>
          등록화면으로
        </button>
      </section>
    </main>
  );
}
function Admin({ onBack }) {
  const empty = { start: '', end: '', employee: '', employeeId: '', merchant: '', status: '' };
  const [filters, setFilters] = useState(empty),
    [applied, setApplied] = useState(empty),
    [all, setAll] = useState([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [expanded, setExpanded] = useState(null),
    [editing, setEditing] = useState(null),
    [action, setAction] = useState(null),
    [deleteChecked, setDeleteChecked] = useState(false);
  const lock = useRef(false);
  const rows = filterReceipts(all, applied);
  async function load() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      setAll(await repo.list());
    } catch (e) {
      setError(inputError(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    load();
  }, []);
  async function mutate(fn) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await fn();
      if (result)
        setAll((list) => list.map((r) => (r.receiptId === result.receiptId ? result : r)));
      else if (action?.kind === 'delete')
        setAll((list) => list.filter((r) => r.receiptId !== action.r.receiptId));
      setAction(null);
      setEditing(null);
      setDeleteChecked(false);
    } catch (e) {
      setError(inputError(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function download() {
    const blob = new Blob([csv(rows)], { type: 'text/csv;charset=utf-8' }),
      url = URL.createObjectURL(blob),
      a = document.createElement('a');
    a.href = url;
    a.download = `영수증등록내역_${applied.start || '전체'}_${applied.end || '전체'}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  return (
    <main className="admin-main">
      <div className="admin-title">
        <div>
          <span className="eyebrow">MANAGEMENT · 관리자 화면</span>
          <h1>영수증 관리</h1>
          <p>등록내역을 확인하고 수정·삭제·처리상태를 관리하세요.</p>
        </div>
        <button className="button secondary" disabled={busy} onClick={onBack}>
          등록화면으로
        </button>
      </div>
      <div className="stats">
        <div>
          <span>검색 결과</span>
          <strong>
            {rows.length}
            <small>건</small>
          </strong>
        </div>
        <div>
          <span>확인필요</span>
          <strong>
            {rows.filter((r) => ['manual_review', 'team_review'].includes(r.status)).length}
            <small>건</small>
          </strong>
        </div>
        <div>
          <span>미처리</span>
          <strong>
            {rows.filter((r) => r.status === 'pending').length}
            <small>건</small>
          </strong>
        </div>
        <div>
          <span>처리완료</span>
          <strong>
            {rows.filter((r) => r.status === 'completed').length}
            <small>건</small>
          </strong>
        </div>
      </div>
      <section className="card filters">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (filters.start && filters.end && filters.start > filters.end) {
              setError('시작일은 종료일보다 늦을 수 없습니다.');
              return;
            }
            setError('');
            setApplied({ ...filters });
          }}
        >
          <div className="filter-grid">
            {[
              ['start', '시작일'],
              ['end', '종료일'],
              ['employee', '사용자 검색'],
              ['merchant', '사용처 검색'],
            ].map(([k, l]) => (
              <label className="field" key={k}>
                <span>{l}</span>
                <input
                  aria-label={l}
                  type={['start', 'end'].includes(k) ? 'date' : 'text'}
                  value={filters[k]}
                  maxLength={160}
                  onChange={(e) => setFilters({ ...filters, [k]: e.target.value })}
                />
              </label>
            ))}
            <label className="field">
              <span>상태 필터</span>
              <select
                aria-label="상태 필터"
                value={filters.status}
                onChange={(e) => setFilters({ ...filters, status: e.target.value })}
              >
                <option value="">전체</option>
                {Object.entries(STATUSES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <button className="button primary" disabled={busy}>
              검색
            </button>
          </div>
        </form>
        <p className="muted filter-note">
          검색은 불러온 전체 내역에 적용됩니다. 새 등록내역은 새로고침으로 확인하세요.
        </p>
      </section>
      <ErrorBox message={error} />
      <section className="card list-card">
        <div className="list-heading">
          <h2>
            등록내역 <span>{rows.length}건</span>
          </h2>
          <div className="list-tools">
            <button className="button secondary small" disabled={busy} onClick={load}>
              새로고침
            </button>
            <button className="button secondary small" disabled={busy} onClick={download}>
              <Icon name="download" size={17} />
              CSV 다운로드
            </button>
          </div>
        </div>
        {busy && (
          <p className="loading" role="status">
            처리 중...
          </p>
        )}
        <div className="receipt-table" role="table" aria-label="등록 영수증">
          <div className="table-head" role="row">
            {['일자', '사용자', '사용처', '금액', '승인번호', '사진', '상태'].map((t) => (
              <span role="columnheader" key={t}>
                {t}
              </span>
            ))}
          </div>
          {rows.length === 0 && !busy && (
            <div className="empty-state">
              <Icon name="receipt" size={36} />
              <h3>등록내역이 없습니다.</h3>
              <p>검색 조건을 변경하거나 새 영수증을 등록해주세요.</p>
            </div>
          )}
          {rows.map((r) => (
            <React.Fragment key={r.receiptId}>
              <div role="row" className={`table-row ${expanded === r.receiptId ? 'selected' : ''}`}>
                <button
                  className="row-open"
                  aria-label={`${r.employeeName} ${r.merchantName || '확인 요청'} 상세내역`}
                  aria-expanded={expanded === r.receiptId}
                  onClick={() => setExpanded(expanded === r.receiptId ? null : r.receiptId)}
                >
                  <span>{r.receiptDate || '확인필요'}</span>
                  <span>{r.employeeName}</span>
                  <strong>{r.merchantName || '확인 요청'}</strong>
                  <span className="row-amount">{money(r.amount)}</span>
                  <span className="row-approval">{display(r, 'approvalNumber')}</span>
                </button>
                <small className="no-image">미보관</small>
                <div>
                  <Badge status={r.status} />
                  {r.suspectedDuplicate && <small className="duplicate-note">중복 의심</small>}
                </div>
              </div>
              {expanded === r.receiptId && (
                <div className="expanded-detail static-detail">
                  <div>
                    <h3>상세내역</h3>
                    <Detail r={r} />
                    <div className="status-actions">
                      <span>처리상태 변경</span>
                      {['manual_review', 'team_review', 'completed'].includes(r.status) && (
                        <button
                          className="button secondary small"
                          disabled={busy}
                          onClick={() =>
                            mutate(() => repo.status(r.receiptId, r.version, 'pending'))
                          }
                        >
                          {r.status === 'completed' ? '미처리로 변경' : '내용 확인 / 미처리로 변경'}
                        </button>
                      )}
                      {r.status === 'pending' && (
                        <button
                          className="button primary small"
                          disabled={busy}
                          onClick={() => {
                            setError('');
                            setAction({ kind: 'complete', r });
                          }}
                        >
                          처리완료로 변경
                        </button>
                      )}
                      <button
                        className="button secondary small"
                        disabled={busy}
                        onClick={() => {
                          setError('');
                          setEditing({ r, ...toForm(r) });
                        }}
                      >
                        수정
                      </button>
                      <button
                        className="button danger-outline small"
                        disabled={busy}
                        onClick={() => {
                          setError('');
                          setDeleteChecked(false);
                          setAction({ kind: 'delete', r });
                        }}
                      >
                        삭제
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </React.Fragment>
          ))}
        </div>
      </section>
      {editing && (
        <Modal title="영수증 수정" wide onClose={() => !busy && setEditing(null)}>
          <p className="muted">
            등록번호와 최초 등록일시는 유지됩니다. 날짜·금액·승인번호 수정 시 중복을 다시
            검사합니다.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              mutate(() =>
                repo.edit(editing.r.receiptId, editing.r.version, editing.core, editing.extras),
              );
            }}
          >
            <fieldset disabled={busy}>
              <CoreFields
                value={editing.core}
                onChange={(core) => setEditing({ ...editing, core })}
                team={editing.r.registrationMethod === 'team'}
              />
              <ExtraFields
                value={editing.extras}
                onChange={(extras) => setEditing({ ...editing, extras })}
                includeMemo
              />
              <ErrorBox message={error} />
              <div className="modal-actions">
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={() => setEditing(null)}
                >
                  취소
                </button>
                <button className="button primary" disabled={busy}>
                  {busy ? '저장 중...' : '수정 저장'}
                </button>
              </div>
            </fieldset>
          </form>
        </Modal>
      )}
      {action && (
        <Modal
          title={action.kind === 'delete' ? '영수증 삭제' : '처리완료 변경'}
          onClose={() => !busy && setAction(null)}
        >
          <p>
            {action.kind === 'delete'
              ? '이 등록내역을 삭제하시겠습니까? 삭제한 내용은 복구할 수 없습니다.'
              : '이 영수증을 처리완료로 변경하시겠습니까?'}
          </p>
          <div className="mini-summary">
            <strong>{action.r.merchantName || '관리팀 확인 요청'}</strong>
            <span>
              {action.r.receiptDate || '확인불가'} · {money(action.r.amount)}
            </span>
          </div>
          {action.kind === 'delete' && (
            <label className="checkbox">
              <input
                type="checkbox"
                checked={deleteChecked}
                onChange={(e) => setDeleteChecked(e.target.checked)}
              />
              위 등록내역을 삭제할 것을 확인했습니다.
            </label>
          )}
          <ErrorBox message={error} />
          <div className="modal-actions">
            <button className="button secondary" disabled={busy} onClick={() => setAction(null)}>
              취소
            </button>
            <button
              className={`button ${action.kind === 'delete' ? 'danger' : 'primary'}`}
              disabled={busy || (action.kind === 'delete' && !deleteChecked)}
              onClick={() =>
                mutate(() =>
                  action.kind === 'delete'
                    ? repo.remove(action.r.receiptId, action.r.version)
                    : repo.status(action.r.receiptId, action.r.version, 'completed'),
                )
              }
            >
              {busy ? '처리 중...' : action.kind === 'delete' ? '삭제 확인' : '확인'}
            </button>
          </div>
        </Modal>
      )}
    </main>
  );
}
createRoot(document.getElementById('root')).render(<App />);
