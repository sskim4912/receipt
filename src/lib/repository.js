import { validateInput, duplicateKey, sha256, allowedTransition, toForm } from './domain.js';
export class ReceiptRepository {
  constructor(
    driver,
    { receipts = 'receipts', duplicates = 'receiptDuplicates', settings = 'appSettings' } = {},
  ) {
    this.driver = driver;
    this.receipts = receipts;
    this.duplicates = duplicates;
    this.settings = settings;
  }
  path(id) {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new Error('등록번호를 확인해주세요.');
    return this.receipts + '/' + id;
  }
  async get(id) {
    return (await this.driver.get(this.path(id)))?.data || null;
  }
  async list() {
    return (await this.driver.list(this.receipts)).sort((a, b) =>
      String(b.createdAt || '').localeCompare(String(a.createdAt || '')),
    );
  }
  async byEmployee(name, id = '') {
    if (!name.trim()) throw new Error('사용자 이름을 입력해주세요.');
    return (await this.driver.list(this.receipts, { field: 'employeeName', value: name.trim() }))
      .filter((r) => !id || r.employeeId === id.trim())
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  }
  async suspected(input, excludeId) {
    if (input.approvalState === 'present' || !input.receiptDate || input.amount === null)
      return false;
    const rows = await this.driver.list(this.receipts, {
      field: 'receiptDate',
      value: input.receiptDate,
    });
    return rows.some(
      (r) =>
        r.receiptId !== excludeId &&
        r.amount === input.amount &&
        r.merchantName === input.merchantName &&
        Date.now() - Date.parse(r.createdAt) < 86400000,
    );
  }
  async create(id, core, extras, mode = 'manual', attempts = 0, recognitionEngine = 'none') {
    const input = validateInput(core, extras, mode),
      key = await duplicateKey(input),
      fingerprint = await sha256(JSON.stringify(input)),
      suspectedDuplicate = await this.suspected(input, id);
    await this.driver.transaction(async (tx) => {
      const existing = await tx.get(this.path(id));
      if (existing) {
        if (existing.requestFingerprint !== fingerprint)
          throw new Error('등록 요청 내용이 변경되었습니다. 새 등록으로 다시 시도해주세요.');
        return;
      }
      if (key && (await tx.get(this.duplicates + '/' + key)))
        throw new Error('동일한 영수증이 이미 등록되어 있습니다.');
      const data = {
        ...input,
        schemaVersion: 2,
        receiptId: id,
        status: mode === 'team' ? 'team_review' : 'manual_review',
        version: 1,
        analysisAttempts: Math.min(3, Math.max(0, attempts)),
        recognitionEngine: recognitionEngine === 'tesseract-browser' ? recognitionEngine : 'none',
        imageStored: false,
        duplicateKey: key,
        suspectedDuplicate,
        requestFingerprint: fingerprint,
      };
      tx.put(this.path(id), data, { timestamps: ['createdAt', 'updatedAt'], create: true });
      if (key)
        tx.put(
          this.duplicates + '/' + key,
          { receiptId: id },
          { timestamps: ['createdAt'], create: true },
        );
    });
    return this.get(id);
  }
  async edit(id, version, core, extras) {
    const prior = await this.get(id);
    if (!prior) throw new Error('영수증을 찾을 수 없습니다.');
    const input = validateInput(core, extras, prior.registrationMethod),
      key = await duplicateKey(input),
      suspectedDuplicate = await this.suspected(input, id);
    await this.driver.transaction(async (tx) => {
      const current = await tx.get(this.path(id));
      if (!current) throw new Error('영수증을 찾을 수 없습니다.');
      if (current.version !== version)
        throw new Error('다른 사용자가 이미 수정했습니다. 새로고침 후 다시 시도해주세요.');
      const newDup = key ? await tx.get(this.duplicates + '/' + key) : null;
      const oldDup =
        current.duplicateKey && current.duplicateKey !== key
          ? await tx.get(this.duplicates + '/' + current.duplicateKey)
          : null;
      if (newDup && newDup.receiptId !== id)
        throw new Error('동일한 영수증이 이미 등록되어 있습니다.');
      tx.put(
        this.path(id),
        {
          ...current,
          ...input,
          duplicateKey: key,
          suspectedDuplicate,
          version: current.version + 1,
        },
        { timestamps: ['updatedAt'] },
      );
      if (oldDup?.receiptId === id) tx.delete(this.duplicates + '/' + current.duplicateKey);
      if (key && !newDup)
        tx.put(
          this.duplicates + '/' + key,
          { receiptId: id },
          { timestamps: ['createdAt'], create: true },
        );
    });
    return this.get(id);
  }
  async status(id, version, status) {
    await this.driver.transaction(async (tx) => {
      const r = await tx.get(this.path(id));
      if (!r) throw new Error('영수증을 찾을 수 없습니다.');
      if (r.version !== version)
        throw new Error('다른 사용자가 이미 수정했습니다. 새로고침 후 다시 시도해주세요.');
      if (['pending', 'completed'].includes(status)) {
        const form = toForm(r);
        try {
          validateInput(form.core, form.extras, 'manual');
        } catch {
          throw new Error('핵심 영수증 정보를 수정·확인한 후 상태를 변경해주세요.');
        }
      }
      if (!allowedTransition(r.status, status))
        throw new Error('내용 확인 후 미처리 상태에서 처리완료로 변경해주세요.');
      tx.put(
        this.path(id),
        { ...r, status, version: r.version + 1 },
        { timestamps: ['updatedAt'] },
      );
    });
    return this.get(id);
  }
  async remove(id, version) {
    await this.driver.transaction(async (tx) => {
      const r = await tx.get(this.path(id));
      if (!r) throw new Error('영수증을 찾을 수 없습니다.');
      if (r.version !== version)
        throw new Error('내용이 변경되었습니다. 새로고침 후 삭제 여부를 다시 확인해주세요.');
      const dup = r.duplicateKey ? await tx.get(this.duplicates + '/' + r.duplicateKey) : null;
      tx.delete(this.path(id));
      if (dup?.receiptId === id) tx.delete(this.duplicates + '/' + r.duplicateKey);
    });
  }
  async gate() {
    return (await this.driver.get(this.settings + '/adminGate'))?.data || null;
  }
  async setupGate(value) {
    await this.driver.transaction(async (tx) => {
      const path = this.settings + '/adminGate';
      if (await tx.get(path))
        throw new Error('다른 사용자가 비밀번호를 설정했습니다. 다시 접속해주세요.');
      tx.put(path, value, { timestamps: ['createdAt'], create: true });
    });
  }
}
