import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { firebaseConfig } from './firebase-config.js';
import { FirestoreRest } from './lib/firestore-rest.js';
import { ReceiptRepository } from './lib/repository.js';
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
import { inspectPhoto } from './lib/photo.js';
import { recognizeReceipt } from './lib/receipt-ocr.js';
import { makeGate, verifyGate } from './lib/admin-gate.js';
import { Icon, Modal, Field, ErrorBox } from './ui.jsx';
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
function Summary({ core }) {
  return (
    <dl className="core-summary">
      {['receiptDate', 'merchantName', 'amount', 'approvalNumber'].map((k) => (
        <div key={k}>
          <dt>{LABELS[k]}</dt>
          <dd className={core[k] == null ? 'unknown' : ''}>{display(core, k)}</dd>
        </div>
      ))}
    </dl>
  );
}
function CoreFields({ value, onChange, team = false }) {
  const set = (k, v) => onChange({ ...value, [k]: v });
  return (
    <>
      <div className="form-grid">
        {['receiptDate', 'merchantName', 'amount', 'approvalNumber'].map((k) => (
          <Field key={k} label={LABELS[k]}>
            <input
              aria-label={LABELS[k]}
              type={k === 'receiptDate' ? 'date' : 'text'}
              inputMode={['amount', 'approvalNumber'].includes(k) ? 'numeric' : undefined}
              value={value[k]}
              required={!team && (k !== 'approvalNumber' || value.approvalState === 'present')}
              disabled={k === 'approvalNumber' && value.approvalState !== 'present'}
              maxLength={k === 'merchantName' ? 160 : k === 'approvalNumber' ? 40 : 12}
              pattern={k === 'amount' ? '[0-9]+' : undefined}
              onChange={(e) => set(k, e.target.value)}
            />
          </Field>
        ))}
      </div>
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
                approvalState: e.target.checked ? 'absent' : team ? 'unreadable' : 'present',
                approvalNumber: '',
              })
            }
          />
          영수증에 승인번호 자체가 없습니다.
        </label>
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
          {[
            'receiptTime',
            'paymentMethod',
            'supplyAmount',
            'vatAmount',
            'businessNumber',
            'cardLast4',
            'items',
          ].map((k) => (
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
  );
}
function ExtraFields({ value, onChange }) {
  const set = (k, v) => onChange({ ...value, [k]: v });
  return (
    <>
      <div className="form-grid">
        <Field label="실제 사용자(당사 임직원)">
          <input
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
          hint={
            value.attendeeCount && !/^(?:[1-9]|[1-9]\d)$/.test(value.attendeeCount)
              ? '참석 인원수는 1~99 사이의 숫자만 입력해주세요.'
              : '1~99명 · 숫자만 입력'
          }
        >
          <input
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
        <Field label="구체적인 사용 목적">
          <input
            aria-label="구체적인 사용 목적"
            value={value.purpose}
            placeholder="예) 관리팀 회식"
            required
            maxLength={1000}
            onChange={(e) => set('purpose', e.target.value)}
          />
        </Field>
        <Field label="사용장소">
          <input
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
        <label className="field">
          <span>메모 (선택)</span>
          <textarea
            aria-label="메모"
            value={value.memo}
            maxLength={1000}
            onChange={(e) => set('memo', e.target.value)}
          />
        </label>
      </div>
    </>
  );
}
function Preview({ photo }) {
  const [large, setLarge] = useState(false);
  return photo ? (
    <>
      <div className="photo-panel">
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
        <small>현재 브라우저에서만 확인 · 서버로 전송하지 않음</small>
      </div>
      {large && (
        <Modal title="현재 영수증 사진" wide onClose={() => setLarge(false)}>
          <img className="modal-image" src={photo.url} alt="현재 영수증 확대" />
          <p className="muted">이 사진은 저장되지 않습니다.</p>
        </Modal>
      )}
    </>
  ) : (
    <div className="notice">
      영수증 원본을 보면서 정보를 입력해주세요. 이번 테스트에서는 사진을 보관하지 않습니다.
    </div>
  );
}
function App() {
  const [screen, setScreen] = useState('upload'),
    [login, setLogin] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [photo, setPhoto] = useState(null),
    [attempts, setAttempts] = useState(0),
    [photoNotice, setPhotoNotice] = useState(''),
    [ocrProgress, setOcrProgress] = useState(''),
    [recognitionEngine, setRecognitionEngine] = useState('none'),
    [core, setCore] = useState({ ...EMPTY_CORE }),
    [extras, setExtras] = useState({ ...EMPTY_EXTRAS }),
    [mode, setMode] = useState('manual'),
    [saved, setSaved] = useState(null),
    [deleteDraft, setDeleteDraft] = useState(false);
  const camera = useRef(),
    lock = useRef(false),
    ocrController = useRef(null),
    requestId = useRef(crypto.randomUUID());
  useEffect(() => () => ocrController.current?.abort(), []);
  useEffect(
    () => () => {
      if (photo) URL.revokeObjectURL(photo.url);
    },
    [photo],
  );
  function reset() {
    setScreen('upload');
    setPhoto(null);
    setAttempts(0);
    setPhotoNotice('');
    setRecognitionEngine('none');
    setOcrProgress('');
    setCore({ ...EMPTY_CORE });
    setExtras({ ...EMPTY_EXTRAS });
    setMode('manual');
    setError('');
    setSaved(null);
    requestId.current = crypto.randomUUID();
  }
  function navigate(next) {
    if (busy) return;
    if (
      photo ||
      Object.values(core).some((v, i) => v && v !== Object.values(EMPTY_CORE)[i]) ||
      extras.employeeName
    ) {
      setDeleteDraft(next);
      return;
    }
    setScreen(next);
    setError('');
  }
  async function selectPhoto(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await inspectPhoto(file);
      setPhoto(result);
      setPhotoNotice(result.notice);
      // Retaking a photo is also a recognition retry. Keep failures until a
      // new receipt is started so three failed attempts reliably reach manual.
      setScreen('photo');
      await runOcr(result, attempts);
    } catch (err) {
      setError(err.message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function runOcr(currentPhoto, failures) {
    const controller = new AbortController();
    ocrController.current = controller;
    setOcrProgress('인식 엔진 준비 중…');
    try {
      const result = await recognizeReceipt(currentPhoto.url, {
        signal: controller.signal,
        onProgress: setOcrProgress,
      });
      setRecognitionEngine('tesseract-browser');
      // Rephotographing the same receipt refreshes fields that OCR can read and
      // keeps any values the employee already corrected by hand.
      setCore((previous) => ({ ...previous, ...result.fields }));
      if (result.complete) {
        setPhotoNotice(
          '자동 인식했습니다. 날짜·사용처·금액·승인번호를 원본과 반드시 비교해주세요.',
        );
        setMode('manual');
        setScreen('manual');
      } else {
        const count = Math.min(3, failures + 1);
        setAttempts(count);
        setPhotoNotice(
          '일부 항목을 읽지 못했습니다. 읽힌 값은 입력란에 채웠습니다. 재시도하거나 다시 촬영해주세요. 3회 실패 시 직접 입력으로 전환합니다.',
        );
        if (count >= 3) {
          setMode('manual');
          setScreen('manual');
          setPhotoNotice(
            '인식 오류가 3회 발생해 직접 입력으로 전환했습니다. 입력이 어려우면 관리팀에 제출해주세요.',
          );
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        setScreen('photo');
        setPhotoNotice('자동 인식을 취소했습니다. 다시 시도하거나 재촬영해주세요.');
      }
      if (err.name !== 'AbortError') {
        const count = Math.min(3, failures + 1);
        setAttempts(count);
        if (count >= 3) {
          setMode('manual');
          setScreen('manual');
          setPhotoNotice(
            '인식 오류가 3회 발생해 직접 입력으로 전환했습니다. 입력이 어려우면 관리팀에 제출해주세요.',
          );
        }
      }
      setError(
        err instanceof Error
          ? err.message
          : '사진을 인식하지 못했습니다. 다시 시도하거나 직접 입력해주세요.',
      );
    } finally {
      ocrController.current = null;
      setOcrProgress('');
    }
  }
  async function retryOcr() {
    if (!photo || lock.current || attempts >= 3) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await runOcr(photo, attempts);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function team() {
    setMode('team');
    setCore((v) => ({ ...v, approvalNumber: '', approvalState: 'unreadable' }));
    setScreen('extras');
    setError('');
  }
  function confirm(e) {
    e.preventDefault();
    try {
      validateInput(
        core,
        {
          ...EMPTY_EXTRAS,
          employeeName: '확인',
          attendeeCount: '1',
          purpose: '확인',
          location: '확인',
        },
        mode,
      );
      setError('');
      setScreen('confirm');
    } catch (err) {
      setError(inputError(err));
    }
  }
  let valid = false;
  try {
    validateInput(core, extras, mode);
    valid = true;
  } catch {}
  async function register(e) {
    e.preventDefault();
    if (lock.current || !valid) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const receipt = await repo.create(
        requestId.current,
        core,
        extras,
        mode,
        attempts,
        recognitionEngine,
      );
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
  const step =
    screen === 'upload' || screen === 'photo'
      ? 0
      : screen === 'manual' || screen === 'confirm'
        ? 1
        : screen === 'extras'
          ? 2
          : 3;
  return (
    <>
      <header className="site-header">
        <button
          className="brand brand-button"
          onClick={() => navigate('upload')}
          disabled={busy}
          aria-label="직원 등록화면"
        >
          <span className="gs-mark">
            GS<span>건설</span>
          </span>
          <span className="brand-divider" />
          <div>
            <strong>Aurora Project</strong>
            <small>현장 영수증 관리</small>
          </div>
        </button>
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
      </header>
      <div className="dev-banner">
        Spark 테스트 · 사진 미보관 · 공개 Firestore 규칙 사용 · 관리자 비밀번호는 화면 잠금용입니다.
      </div>
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
          <div className="page-intro">
            <span className="eyebrow">AURORA PROJECT · 직원 화면</span>
            <h1>영수증 등록</h1>
            <p>영수증을 확인하고, 사용내역을 간편하게 기록하세요.</p>
          </div>
          <div className="employee-nav">
            <button className="text-button" onClick={() => navigate('history')} disabled={busy}>
              처리상태 조회
            </button>
          </div>
          <ol className="steps" aria-label="등록 단계">
            {['사진 확인', '내용 입력', '추가정보', '등록 완료'].map((s, i) => (
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
          <input
            ref={camera}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={selectPhoto}
          />
          {(screen === 'upload' || screen === 'photo') && (
            <section className="upload-card">
              <div className="upload-symbol">
                <Icon name="receipt" size={44} />
              </div>
              <h2>
                영수증 전체가 보이도록
                <br />
                선명하게 촬영해주세요.
              </h2>
              <p className="muted">
                촬영하면 기기 안에서 글자를 자동으로 읽습니다.
                <br />
                사진은 현재 브라우저에서만 확인하며 저장하지 않습니다.
              </p>
              <div className="upload-actions">
                <button
                  className="button primary camera-button"
                  disabled={busy}
                  onClick={() => camera.current.click()}
                >
                  <Icon name="camera" />
                  {busy ? '자동 인식 중...' : '영수증 촬영'}
                </button>
              </div>
              {busy && (
                <p className="loading" role="status">
                  <span className="spinner" />
                  {ocrProgress || '사진 확인 중...'}
                </p>
              )}
              {busy && (
                <button className="button text full" onClick={() => ocrController.current?.abort()}>
                  인식 취소
                </button>
              )}
              {photo && <Preview photo={photo} />}
              <div className="notice">
                {photoNotice ||
                  '화면의 촬영 버튼으로 다시 찍거나 자동 인식을 재시도할 수 있습니다.'}
                {attempts > 0 && <small>인식 오류 {attempts}/3</small>}
              </div>
              {photo && !busy && (
                <div className="upload-actions">
                  <button className="button secondary" disabled={attempts >= 3} onClick={retryOcr}>
                    자동 인식 재시도
                  </button>
                  <button className="button secondary" onClick={() => camera.current.click()}>
                    다시 촬영
                  </button>
                </div>
              )}
              <div className="photo-tips">
                <h3>촬영 전 확인해주세요</h3>
                <ul>
                  {[
                    '영수증 전체 촬영',
                    '빛 반사 없이',
                    '흔들림 없이',
                    '업체명 · 금액 · 날짜 · 승인번호가 선명하게',
                  ].map((t) => (
                    <li key={t}>
                      <Icon name="check" size={16} />
                      {t}
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}
          {screen === 'manual' && (
            <section className="card">
              <h2>영수증 직접 입력</h2>
              <p className="muted">
                자동 인식값은 틀릴 수 있습니다. 핵심 4개 항목을 원본과 비교하고 수정해주세요. 읽을
                수 없는 값은 추정하지 마세요.
              </p>
              {photoNotice && (
                <div className="notice" role="status">
                  {photoNotice}
                  {attempts > 0 && <small>인식 오류 {attempts}/3</small>}
                </div>
              )}
              <div className="result-layout">
                <Preview photo={photo} />
                <form onSubmit={confirm}>
                  <CoreFields value={core} onChange={setCore} />
                  <button className="button primary full">입력내용 확인</button>
                  <button type="button" className="button text full" onClick={team}>
                    입력이 어려우면 관리팀에 제출
                  </button>
                  <button
                    type="button"
                    className="button text full"
                    onClick={() => {
                      setScreen('photo');
                      setError('');
                    }}
                  >
                    사진 다시 확인
                  </button>
                </form>
              </div>
            </section>
          )}
          {screen === 'confirm' && (
            <section className="card compact">
              <h2>직접 입력한 내용을 확인해주세요.</h2>
              <Summary core={{ ...core, amount: core.amount ? Number(core.amount) : null }} />
              <div className="notice">사진과 숫자·날짜·사용처가 일치하는지 확인해주세요.</div>
              <button className="button primary full" onClick={() => setScreen('extras')}>
                맞습니다 / 다음으로
              </button>
              <button className="button secondary full" onClick={() => setScreen('manual')}>
                수정
              </button>
            </section>
          )}
          {screen === 'extras' && (
            <section className="card compact">
              <div className="section-heading">
                <span className="section-number">03</span>
                <div>
                  <h2>추가정보 입력</h2>
                  <p>모든 필수 항목을 입력하면 등록할 수 있습니다.</p>
                </div>
              </div>
              {mode === 'team' ? (
                <div className="notice warning">
                  관리팀에 확인 요청 내역을 등록합니다.
                  <br />
                  <strong>사진은 전송되지 않습니다.</strong> 영수증 원본 또는 사진을 관리팀에 별도로
                  전달해주세요.
                </div>
              ) : (
                <div className="mini-summary">
                  <strong>{core.merchantName}</strong>
                  <span>
                    {core.receiptDate} · {money(core.amount)}
                  </span>
                </div>
              )}
              <form onSubmit={register}>
                <fieldset disabled={busy}>
                  <ExtraFields value={extras} onChange={setExtras} />
                  <div className="notice">
                    입력한 정보만 Firestore에 저장됩니다. 사진은 저장하지 않습니다.
                  </div>
                  <button className="button primary full" disabled={!valid || busy}>
                    {busy ? (
                      <>
                        <span className="spinner" />
                        등록 중...
                      </>
                    ) : (
                      '등록하기'
                    )}
                  </button>
                  <button
                    type="button"
                    className="button text full"
                    onClick={() => {
                      setScreen(mode === 'team' ? 'manual' : 'confirm');
                      setMode('manual');
                      setError('');
                    }}
                  >
                    이전으로
                  </button>
                </fieldset>
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
              {mode === 'team' && (
                <div className="notice warning">
                  사진은 전달되지 않았습니다. 관리팀에 원본을 별도로 전달해주세요.
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
          <div className="trust-note">
            <Icon name="receipt" size={16} />
            <span>영수증 원본을 보관하고 정확한 사용내역을 기록해주세요.</span>
          </div>
        </main>
      )}
      <footer>
        GS건설 <span>·</span>Aurora Project
      </footer>
      {login && (
        <Login
          onClose={() => setLogin(false)}
          onSuccess={() => {
            setLogin(false);
            setPhoto(null);
            setScreen('admin');
            setError('');
          }}
        />
      )}
      {deleteDraft && (
        <Modal title="화면 이동" onClose={() => setDeleteDraft(false)}>
          <p>이동하면 입력 중인 내용과 임시 사진이 사라집니다. 이동하시겠습니까?</p>
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
        {Object.keys(LABELS).map((k) => (
          <div key={k}>
            <dt>{LABELS[k]}</dt>
            <dd>{display(r, k) || '—'}</dd>
          </div>
        ))}
      </dl>
      <p className="file-label">등록번호: {r.receiptId}</p>
      <div className="notice">
        사진 미보관 · 원본 사진은 이 앱에서 조회할 수 없습니다. 별도로 전달받은 영수증과 내용을
        비교해주세요.
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
    [number, setNumber] = useState(''),
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
      const result = number.trim() ? await repo.get(number.trim()) : null;
      setRows(number.trim() ? (result ? [result] : []) : await repo.byEmployee(name, id));
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
        <p>사용자 이름 또는 등록번호로 현재 상태를 확인하세요.</p>
      </div>
      <section className="card history-card">
        <form onSubmit={search}>
          <label className="field">
            <span>사용자 이름</span>
            <input
              aria-label="조회할 사용자 이름"
              value={name}
              required={!number.trim()}
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
          <label className="field">
            <span>또는 등록번호</span>
            <input
              aria-label="등록번호"
              value={number}
              maxLength={100}
              onChange={(e) => setNumber(e.target.value)}
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
