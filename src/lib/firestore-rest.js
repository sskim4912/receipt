// Firestore's public REST API, with security rules applied to every request.
// Receipt bytes live in Google Cloud Storage via the Worker; Firestore stores only their object key and name.
export function encodeValue(v) {
  if (v === null) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number')
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encodeValue) } };
  if (v && typeof v === 'object') return { mapValue: { fields: encodeFields(v) } };
  throw new Error('저장할 수 없는 값입니다.');
}
export function encodeFields(data) {
  return Object.fromEntries(
    Object.entries(data)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, encodeValue(v)]),
  );
}
export function decodeValue(v) {
  if ('nullValue' in v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decodeValue);
  if ('mapValue' in v) return decodeFields(v.mapValue.fields || {});
  return null;
}
export function decodeFields(fields) {
  return Object.fromEntries(Object.entries(fields || {}).map(([k, v]) => [k, decodeValue(v)]));
}
export class FirestoreError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
const messages = {
  PERMISSION_DENIED: 'Firestore에 접근할 권한이 없습니다. 프로젝트 보안 규칙을 확인해주세요.',
  RESOURCE_EXHAUSTED:
    'Firestore 요청 또는 무료 사용량 한도에 도달했습니다. 잠시 후 다시 시도해주세요.',
  UNAVAILABLE: 'Firestore 연결이 원활하지 않습니다. 입력내용을 유지한 채 다시 시도해주세요.',
  DEADLINE_EXCEEDED: 'Firestore 응답이 지연됩니다. 잠시 후 다시 시도해주세요.',
  FAILED_PRECONDITION: 'Firestore 설정 또는 저장 상태를 확인해주세요.',
  NOT_FOUND: '저장된 내역을 찾을 수 없습니다.',
};
export class FirestoreRest {
  constructor(config, { fetcher = (...args) => globalThis.fetch(...args) } = {}) {
    this.config = config;
    this.fetch = fetcher;
    this.name = `projects/${config.projectId}/databases/(default)/documents`;
    this.root = `https://firestore.googleapis.com/v1/${this.name}`;
  }
  async request(suffix, { method = 'GET', body, params = {} } = {}) {
    const url = new URL(this.root + suffix);
    url.searchParams.set('key', this.config.apiKey);
    for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);
    let res;
    try {
      res = await this.fetch(url.toString(), {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      throw new FirestoreError('UNAVAILABLE', messages.UNAVAILABLE);
    }
    let json;
    try {
      json = await res.json();
    } catch {
      throw new FirestoreError('UNAVAILABLE', messages.UNAVAILABLE);
    }
    if (!res.ok) {
      const code = json.error?.status || 'UNKNOWN';
      throw new FirestoreError(
        code,
        messages[code] || 'Firestore 처리에 실패했습니다. 다시 시도해주세요.',
      );
    }
    return json;
  }
  async get(path, transaction) {
    try {
      const doc = await this.request('/' + path, { params: { transaction } });
      return { data: decodeFields(doc.fields), updateTime: doc.updateTime };
    } catch (err) {
      if (err.code === 'NOT_FOUND') return null;
      throw err;
    }
  }
  async list(collection, filter) {
    if (filter) {
      const result = await this.request(':runQuery', {
        method: 'POST',
        body: {
          structuredQuery: {
            from: [{ collectionId: collection }],
            where: {
              fieldFilter: {
                field: { fieldPath: filter.field },
                op: 'EQUAL',
                value: encodeValue(filter.value),
              },
            },
          },
        },
      });
      return result
        .filter((x) => x.document)
        .map((x) => ({
          id: x.document.name.split('/').at(-1),
          ...decodeFields(x.document.fields),
        }));
    }
    let token,
      rows = [];
    do {
      const body = await this.request('/' + collection, {
        params: { pageSize: '1000', pageToken: token },
      });
      rows.push(
        ...(body.documents || []).map((d) => ({
          id: d.name.split('/').at(-1),
          ...decodeFields(d.fields),
        })),
      );
      token = body.nextPageToken;
    } while (token);
    return rows;
  }
  async transaction(fn) {
    // Anonymous Spark clients cannot begin REST read-write transactions. Use a single
    // atomic commit with each document's updateTime / exists precondition instead.
    for (let attempt = 0; attempt < 5; attempt++) {
      const reads = new Map(),
        writes = [];
      const tx = {
        get: async (path) => {
          if (!reads.has(path)) reads.set(path, await this.get(path));
          return reads.get(path)?.data || null;
        },
        put: (path, data, { timestamps = [], create = false } = {}) => {
          const prior = reads.get(path),
            fields = encodeFields(data);
          for (const key of ['createdAt', 'updatedAt'])
            if (typeof data[key] === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(data[key]))
              fields[key] = { timestampValue: data[key] };
          const currentDocument =
            create || prior === null
              ? { exists: false }
              : prior
                ? { updateTime: prior.updateTime }
                : { exists: true };
          writes.push({
            update: { name: this.name + '/' + path, fields },
            currentDocument,
            ...(timestamps.length
              ? {
                  updateTransforms: timestamps.map((fieldPath) => ({
                    fieldPath,
                    setToServerValue: 'REQUEST_TIME',
                  })),
                }
              : {}),
          });
        },
        delete: (path) => {
          const prior = reads.get(path);
          if (!prior) throw new Error('삭제할 등록내역을 다시 확인해주세요.');
          writes.push({
            delete: this.name + '/' + path,
            currentDocument: { updateTime: prior.updateTime },
          });
        },
      };
      const result = await fn(tx);
      if (!writes.length) return result;
      try {
        await this.request(':commit', { method: 'POST', body: { writes } });
        return result;
      } catch (err) {
        if (
          ['ABORTED', 'FAILED_PRECONDITION', 'ALREADY_EXISTS'].includes(err.code) &&
          attempt < 4
        ) {
          await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
          continue;
        }
        throw err;
      }
    }
    throw new Error('동시 저장 요청이 많습니다. 다시 시도해주세요.');
  }
}
