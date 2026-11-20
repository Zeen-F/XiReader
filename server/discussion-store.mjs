import { DatabaseSync } from 'node:sqlite';
import { lstatSync } from 'node:fs';
import path from 'node:path';

export const MAX_DISCUSSION_BYTES = 8 * 1024 * 1024;

/** Standalone SQLite is authoritative. In vault mode it is only a projection:
 * successful sidecar writes survive even a later SQLite failure and replay by
 * requestId on the next read. No note/frontmatter or original PDF is changed. */
export function createDiscussionStore({ dataDir, vaultStore, validate, HttpError, databaseName = 'discussions.sqlite', emptyState = id => ({ schemaVersion:1, documentId:id, threads:[], requests:[] }) }) {
  const filename = path.join(dataDir, databaseName);
  try {
    const stat = lstatSync(filename);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('讨论数据库必须是普通文件，不能使用符号链接。');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const db = new DatabaseSync(filename);
  try {
    db.exec('PRAGMA busy_timeout=5000;');
    const version = db.prepare('PRAGMA user_version').get().user_version;
    if (version > 1) throw new Error('讨论记录来自较新版本，请使用相应版本打开；未降级或覆盖。');
    if (version === 0 && db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get().count) {
      throw new Error('已有讨论数据库缺少格式版本；未重新初始化或覆盖。');
    }
    if (version === 1 && !['document_id','state'].every(column => db.prepare('PRAGMA table_info(discussion_documents)').all().some(row => row.name === column))) {
      throw new Error('讨论数据库结构不完整，请恢复备份；未新建空表覆盖。');
    }
    if (db.prepare('PRAGMA quick_check').all().some(row => row.quick_check !== 'ok')) throw new Error('讨论数据库完整性检查失败，请恢复备份。');
    db.exec('PRAGMA journal_mode=WAL; BEGIN IMMEDIATE;');
    try {
      db.exec('CREATE TABLE IF NOT EXISTS discussion_documents(document_id TEXT PRIMARY KEY, state TEXT NOT NULL); PRAGMA user_version=1; COMMIT;');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  } catch (error) { db.close(); throw error; }
  const get = db.prepare('SELECT state FROM discussion_documents WHERE document_id=?');
  const put = db.prepare('INSERT INTO discussion_documents(document_id,state) VALUES (?,?) ON CONFLICT(document_id) DO UPDATE SET state=excluded.state');
  const parse = (source, id) => {
    if (Buffer.byteLength(source,'utf8') > MAX_DISCUSSION_BYTES) throw new HttpError(409,'讨论文件超过安全上限，请保留原文件并拆分记录。');
    let state;
    try { state = JSON.parse(source); } catch { throw new HttpError(409,'讨论文件已损坏，请恢复备份；原文件未被覆盖。'); }
    validate(state, id);
    return state;
  };
  function load(id) {
    const cached = get.get(id);
    if (!vaultStore) return { state: cached ? parse(cached.state,id) : emptyState(id), token:null };
    const saved = vaultStore.readDiscussions(id);
    if (!saved && cached) throw new HttpError(409,'已保存的讨论文件缺失，请恢复 Discussions 中的原文件；没有创建空讨论覆盖历史。');
    return { state: saved ? parse(saved.source,id) : emptyState(id), token:saved?.token ?? null };
  }
  function transact(id, work) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const baseline = load(id), original = JSON.stringify(baseline.state);
      const result = work(baseline.state);
      validate(baseline.state,id);
      const next = JSON.stringify(baseline.state);
      // Reserve the newline used by both authoritative sidecars and JSON export.
      if (Buffer.byteLength(next,'utf8') + 1 > MAX_DISCUSSION_BYTES) throw new HttpError(413,'本篇讨论已达到 8 MiB 保存上限；本次内容未追加，请保留草稿。');
      if (next !== original && vaultStore) {
        try { vaultStore.writeDiscussions(id,`${next}\n`,baseline.token); }
        catch {
          // An atomic publish may have succeeded before readback/recovery failed.
          // Never label this a definite rejection: clients must retain the exact
          // requestId, read the authoritative file and safely replay if needed.
          const error = new HttpError(503,'讨论保存结果待核对，请保留草稿并重新读取；需要重试时使用同一请求，不要创建另一条消息。');
          error.code = 'DISCUSSION_SAVE_UNCERTAIN';
          throw error;
        }
      }
      // A missing/new document with no discussion does not establish an empty
      // sidecar. Existing authoritative sidecars are projected even on reads.
      const cached = get.get(id);
      if ((baseline.token !== null || next !== original || cached) && cached?.state !== next) put.run(id,next);
      db.exec('COMMIT');
      return result;
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  return { read: id => transact(id,state => structuredClone(state)), mutate: transact, close: () => db.close() };
}
