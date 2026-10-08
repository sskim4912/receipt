import { encodeFields, decodeFields, decodeValue } from '../src/lib/firestore-rest.js';
// Test-only REST transport. Never imported by the shipped application.
export class FakeFirestore {
  constructor() {
    this.docs = new Map();
    this.clock = 0;
    this.failCommit = false;
    this.loseCommitResponse = false;
    this.bodies = [];
  }
  stamp() {
    return new Date(Date.now() + ++this.clock).toISOString();
  }
  seed(path, data) {
    this.docs.set(path, { data: { ...data }, updateTime: this.stamp() });
  }
  doc(path) {
    const r = this.docs.get(path);
    return r
      ? {
          name: 'projects/test/databases/(default)/documents/' + path,
          fields: encodeFields(r.data),
          updateTime: r.updateTime,
        }
      : null;
  }
  async handle(url, method, body) {
    const u = new URL(url);
    let path = u.pathname.split('/documents')[1] || '';
    if (body) this.bodies.push(body);
    const error = (status, code) => ({ status, body: { error: { status: code, message: code } } });
    if (path === ':commit') {
      if (this.failCommit) {
        this.failCommit = false;
        return error(503, 'UNAVAILABLE');
      }
      for (const w of body.writes) {
        const p = (w.update?.name || w.delete).split('/documents/')[1],
          r = this.docs.get(p),
          condition = w.currentDocument;
        if (condition?.exists === false && r) return error(409, 'ALREADY_EXISTS');
        if (condition?.exists === true && !r) return error(400, 'FAILED_PRECONDITION');
        if (condition?.updateTime && condition.updateTime !== r?.updateTime)
          return error(400, 'FAILED_PRECONDITION');
      }
      const stamp = this.stamp();
      for (const w of body.writes) {
        const p = (w.update?.name || w.delete).split('/documents/')[1];
        if (w.delete) this.docs.delete(p);
        else {
          const data = decodeFields(w.update.fields);
          for (const transform of w.updateTransforms || []) data[transform.fieldPath] = stamp;
          this.docs.set(p, { data, updateTime: stamp });
        }
      }
      if (this.loseCommitResponse) {
        this.loseCommitResponse = false;
        return error(503, 'UNAVAILABLE');
      }
      return { status: 200, body: { commitTime: stamp, writeResults: [] } };
    }
    if (path === ':runQuery') {
      const q = body.structuredQuery,
        filter = q.where.fieldFilter;
      return {
        status: 200,
        body: [...this.docs]
          .filter(
            ([p, r]) =>
              p.split('/')[0] === q.from[0].collectionId &&
              r.data[filter.field.fieldPath] === decodeValue(filter.value),
          )
          .map(([p]) => ({ document: this.doc(p) })),
      };
    }
    path = decodeURIComponent(path.slice(1));
    if (path.split('/').length === 1)
      return {
        status: 200,
        body: {
          documents: [...this.docs.keys()]
            .filter((p) => p.split('/')[0] === path)
            .map((p) => this.doc(p)),
        },
      };
    const d = this.doc(path);
    return d ? { status: 200, body: d } : error(404, 'NOT_FOUND');
  }
  async fetch(url, opts = {}) {
    const result = await this.handle(
      url,
      opts.method || 'GET',
      opts.body ? JSON.parse(opts.body) : undefined,
    );
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
