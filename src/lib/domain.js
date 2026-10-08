import { z } from 'zod';
export const STATUSES = {
  manual_review: '수기입력·확인필요',
  team_review: '관리팀 확인필요',
  pending: '미처리',
  completed: '처리완료',
};
export const METHODS = { manual: '수기입력', team: '관리팀 제출' };
export const CATEGORIES = ['식비', '교통비', '숙박비', '자재·소모품', '기타'];
export const LABELS = {
  receiptDate: '승인일자',
  receiptTime: '승인시간',
  merchantName: '업체명',
  amount: '영수금액',
  approvalNumber: '승인번호(선택)',
  category: '분류',
  paymentMethod: '결제수단',
  supplyAmount: '공급가액',
  vatAmount: '부가세',
  businessNumber: '사업자번호',
  cardLast4: '카드번호 마지막 4자리',
  items: '품목/메뉴',
  employeeId: '사번(선택)',
  employeeName: '실제 사용자',
  attendeeCount: '참석 인원수',
  purpose: '구체적인 사용 목적',
  location: '사용장소',
  memo: '메모',
  registrationMethod: '등록방식',
  status: '처리상태',
  createdAt: '등록일시',
  updatedAt: '수정일시',
};
export const EMPTY_CORE = {
  receiptDate: '',
  receiptTime: '',
  merchantName: '',
  amount: '',
  approvalNumber: '',
  approvalState: 'unreadable',
  category: '기타',
  paymentMethod: '',
  supplyAmount: '',
  vatAmount: '',
  businessNumber: '',
  cardLast4: '',
  items: '',
};
export const EMPTY_EXTRAS = {
  employeeId: '',
  employeeName: '',
  attendeeCount: '',
  purpose: '',
  location: '',
  memo: '',
};
export function validDate(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(v + 'T00:00:00Z');
  return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === v;
}
const text = z
  .string()
  .trim()
  .min(1, '필수정보를 모두 입력해주세요.')
  .max(160, '160자 이내로 입력해주세요.');
const optional = z.string().trim().max(160).default('');
const moneyInput = z
  .string()
  .regex(/^(0|[1-9]\d*)$/, '금액은 숫자만 입력해주세요.')
  .transform(Number)
  .refine((v) => Number.isSafeInteger(v) && v <= 999999999999, '금액 범위를 확인해주세요.');
const optionalMoney = z.union([z.literal('').transform(() => null), moneyInput]);
export const extrasSchema = z.object({
  employeeId: z.string().trim().max(40),
  employeeName: text,
  attendeeCount: z
    .string()
    .regex(/^(?:[1-9]|[1-9]\d)$/, '참석 인원수는 1~99 사이의 숫자만 입력해주세요.')
    .transform(Number),
  purpose: z.string().trim().min(1, '구체적인 사용 목적을 입력해주세요.').max(1000),
  location: text,
  memo: z.string().trim().max(1000),
});
const sharedCore = {
  receiptDate: z.union([
    z.literal('').transform(() => null),
    z.string().refine(validDate, '승인일자를 확인해주세요.'),
  ]),
  receiptTime: z.union([
    z.literal(''),
    z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, '승인시간을 확인해주세요.'),
  ]),
  merchantName: optional,
  amount: optionalMoney,
  approvalNumber: z.union([
    z.literal(''),
    z.string().regex(/^\d{1,40}$/, '승인번호는 숫자만 입력해주세요.'),
  ]),
  approvalState: z.enum(['present', 'absent', 'unreadable']),
  category: z.enum(CATEGORIES),
  paymentMethod: optional,
  supplyAmount: optionalMoney,
  vatAmount: optionalMoney,
  businessNumber: z.union([
    z.literal(''),
    z.string().regex(/^(\d{10}|\d{3}-\d{2}-\d{5})$/, '사업자등록번호를 확인해주세요.'),
  ]),
  cardLast4: z.union([
    z.literal(''),
    z.string().regex(/^\d{4}$/, '카드번호 마지막 4자리만 입력해주세요.'),
  ]),
  items: z.string().trim().max(1000),
};
const coreBase = z.object(sharedCore).superRefine((v, c) => {
  if (v.approvalState !== 'present' && v.approvalNumber)
    c.addIssue({
      code: 'custom',
      message: '승인번호 입력 상태를 확인해주세요.',
      path: ['approvalState'],
    });
});
export function validateInput(core, extras, mode = 'manual') {
  if (!['manual', 'team'].includes(mode)) throw new Error('등록방식을 확인해주세요.');
  const extra = extrasSchema.parse(extras),
    base = coreBase.parse(core);
  if (mode === 'manual') {
    if (!base.receiptDate) throw new Error('승인일자를 입력해주세요.');
    if (!base.receiptTime) throw new Error('승인시간을 입력해주세요.');
    if (!base.merchantName) throw new Error('업체명을 입력해주세요.');
    if (base.amount === null || base.amount <= 0)
      throw new Error('영수금액은 1원 이상 입력해주세요.');
  }
  return {
    ...base,
    ...extra,
    approvalState: base.approvalNumber
      ? 'present'
      : base.approvalState === 'absent'
        ? 'absent'
        : 'unreadable',
    merchantName: base.merchantName || null,
    approvalNumber: base.approvalNumber || null,
    registrationMethod: mode,
  };
}
export function inputError(err) {
  return err?.issues?.[0]?.message || err?.message || '입력내용을 확인해주세요.';
}
export function money(v) {
  return v == null ? '확인불가' : `${Number(v).toLocaleString('ko-KR')}원`;
}
export function display(r, key) {
  if (['amount', 'supplyAmount', 'vatAmount'].includes(key)) return money(r[key]);
  if (key === 'approvalNumber' && r.approvalState === 'absent') return '승인번호 없음';
  if (key === 'approvalNumber' && r.approvalState === 'unreadable' && !r[key]) return '미확인';
  if (key === 'status') return STATUSES[r[key]] || r[key];
  if (key === 'registrationMethod') return METHODS[r[key]] || r[key];
  if (['createdAt', 'updatedAt'].includes(key))
    return r[key]
      ? new Date(r[key]).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
      : '확인불가';
  return r[key] ?? '확인불가';
}
export async function sha256(text) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(hash)].map((v) => v.toString(16).padStart(2, '0')).join('');
}
export async function duplicateKey(r) {
  return r.approvalState === 'present' && r.approvalNumber
    ? sha256(JSON.stringify([r.receiptDate, r.amount, r.approvalNumber]))
    : null;
}
export function filterReceipts(rows, f) {
  return rows.filter(
    (r) =>
      (!f.start || (r.receiptDate && r.receiptDate >= f.start)) &&
      (!f.end || (r.receiptDate && r.receiptDate <= f.end)) &&
      (!f.employee || (r.employeeName || '').includes(f.employee)) &&
      (!f.employeeId || (r.employeeId || '').includes(f.employeeId)) &&
      (!f.merchant || (r.merchantName || '').includes(f.merchant)) &&
      (!f.status || r.status === f.status),
  );
}
export function toForm(r) {
  const core = { ...EMPTY_CORE },
    extras = { ...EMPTY_EXTRAS };
  for (const k of Object.keys(core)) core[k] = r[k] == null ? '' : String(r[k]);
  for (const k of Object.keys(extras)) extras[k] = r[k] == null ? '' : String(r[k]);
  core.approvalState = r.approvalState || 'unreadable';
  core.category = r.category || '기타';
  return { core, extras };
}
const csvFields = [
  'receiptId',
  'receiptDate',
  'receiptTime',
  'merchantName',
  'businessNumber',
  'category',
  'amount',
  'approvalNumber',
  'employeeId',
  'employeeName',
  'attendeeCount',
  'purpose',
  'location',
  'memo',
  'registrationMethod',
  'status',
  'createdAt',
  'updatedAt',
];
export function csv(rows) {
  const cell = (v) => {
    let s = String(v ?? '');
    if (/^\s*[=+\-@]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  };
  return (
    '\uFEFF' +
    [
      csvFields.map((k) => cell(LABELS[k] || '등록번호')).join(','),
      ...rows.map((r) =>
        csvFields
          .map((k) => cell(['status', 'registrationMethod'].includes(k) ? display(r, k) : r[k]))
          .join(','),
      ),
    ].join('\r\n')
  );
}
export function allowedTransition(old, next) {
  return old === 'completed'
    ? next === 'pending'
    : old === 'pending'
      ? next === 'completed'
      : ['manual_review', 'team_review'].includes(old) && next === 'pending';
}
