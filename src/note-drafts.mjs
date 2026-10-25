import { mergeNotes, MAX_NOTE_LENGTH } from '../shared/notes.mjs';

const SCHEMA = 'paperdesk-note-draft/v2';
const DRAFT = 'paperdesk-note-draft-v2:';
const POINTER = 'paperdesk-note-draft-slot-v2:';
const PRESERVED = 'paperdesk-note-preserved-v2:';
const uuid = () => globalThis.crypto.randomUUID();
const validId = value => typeof value === 'string' && value.length > 0;
const stamp = () => new Date().toISOString();

/**
 * Local slots belong to a confirmed library, document and runtime owner. The
 * sessionStorage pointer is window-local (and copied on tab duplication), and
 * may only point to a validated owner slot in that same library/document.
 * Reloads can recover the pointer, but only their new owner slot may be erased.
 * Unscoped v1 keys are read-only recovery candidates, never active drafts.
 */
export function createNoteDraftStore({ libraryId, owner = uuid(), local, session } = {}) {
  let storageError = false;
  try { if (local === undefined) local = globalThis.localStorage; } catch { local = null; storageError = true; }
  try { if (session === undefined) session = globalThis.sessionStorage; } catch { session = null; storageError = true; }
  const cache = new Map(), saved = new Set();
  const scope = documentId => {
    if (!validId(libraryId) || !validId(documentId) || !validId(owner)) throw new Error('正在核对文献库，请稍候再编辑笔记。');
    return `${encodeURIComponent(libraryId)}:${encodeURIComponent(documentId)}:`;
  };
  const key = documentId => `${DRAFT}${scope(documentId)}${encodeURIComponent(owner)}`;
  const pointer = documentId => `${POINTER}${scope(documentId)}`;
  const parse = (storage, storedKey) => {
    let raw;
    try { raw = storage.getItem(storedKey); } catch { storageError = true; return null; }
    try { return JSON.parse(raw || 'null'); } catch { return null; }
  };
  const validate = (value, documentId, storedKey, archived = false) => {
    if (!value || value.schema !== SCHEMA || value.libraryId !== libraryId || value.documentId !== documentId
      || !validId(value.owner) || !validId(value.generation) || typeof value.text !== 'string' || value.text.length > MAX_NOTE_LENGTH
      || (value.baseRevision != null && typeof value.baseRevision !== 'string')) return null;
    const ownStem = `${archived ? PRESERVED : DRAFT}${scope(documentId)}${encodeURIComponent(value.owner)}`;
    if (archived ? !storedKey.startsWith(`${ownStem}:`) : storedKey !== ownStem) return null;
    return { ...value, key: storedKey };
  };
  const read = documentId => {
    if (!validId(libraryId) || saved.has(documentId)) return null;
    if (cache.has(documentId)) return cache.get(documentId);
    const pointed = (() => { try { return session.getItem(pointer(documentId)); } catch { storageError = true; return null; } })();
    if (pointed === 'saved') return null;
    const candidates = [key(documentId)];
    if (pointed && pointed !== 'saved' && pointed.startsWith(`${DRAFT}${scope(documentId)}`)) candidates.push(pointed);
    for (const storedKey of candidates) {
      const value = validate(parse(local, storedKey), documentId, storedKey);
      if (value) { cache.set(documentId, value); return value; }
    }
    return null;
  };
  const entry = (documentId, text, baseRevision) => {
    scope(documentId);
    if (typeof text !== 'string' || text.length > MAX_NOTE_LENGTH || (baseRevision != null && typeof baseRevision !== 'string')) throw new Error('笔记草稿格式无效，请先复制并核对内容。');
    return { schema: SCHEMA, libraryId, documentId, owner, generation: uuid(), text, baseRevision, updatedAt: stamp() };
  };
  const persist = action => {
    try { action(); storageError = false; } catch (error) { storageError = true; throw error; }
  };
  const write = (documentId, text, baseRevision) => {
    const value = { ...entry(documentId, text, baseRevision), key: key(documentId) };
    // Storage errors must not lose edits or make a later save inspect stale disk.
    cache.set(documentId, value); saved.delete(documentId);
    persist(() => {
      const { key: storedKey, ...record } = value;
      local.setItem(storedKey, JSON.stringify(record));
      session.setItem(pointer(documentId), storedKey);
    });
    return value;
  };
  const clear = (documentId, snapshot) => {
    const current = read(documentId);
    if (!current || current.text !== snapshot) return false;
    persist(() => {
      // Record acknowledgement first: if this fails the draft is still readable.
      session.setItem(pointer(documentId), 'saved');
      const owned = validate(parse(local, key(documentId)), documentId, key(documentId));
      if (owned?.generation === current.generation) local.removeItem(key(documentId));
    });
    cache.delete(documentId); saved.add(documentId);
    return true;
  };
  const preserve = (documentId, text, baseRevision) => {
    const value = { ...entry(documentId, text, baseRevision), savedAt: stamp() };
    const storedKey = `${PRESERVED}${scope(documentId)}${encodeURIComponent(owner)}:${value.generation}`;
    // Persist the actual editor before replacing it, including memory-only text.
    persist(() => local.setItem(storedKey, JSON.stringify(value)));
    return { ...value, key: storedKey };
  };
  const keys = () => {
    const entries = [];
    try { for (let index = 0; index < local.length; index++) { const storedKey = local.key(index); if (storedKey) entries.push(storedKey); } }
    catch { storageError = true; }
    return entries;
  };
  const list = (documentId, archived) => {
    if (!validId(libraryId)) return [];
    const prefix = `${archived ? PRESERVED : DRAFT}${scope(documentId)}`;
    return keys().filter(storedKey => storedKey.startsWith(prefix))
      .map(storedKey => validate(parse(local, storedKey), documentId, storedKey, archived)).filter(Boolean)
      .sort((a, b) => String(b.savedAt || b.updatedAt || '').localeCompare(String(a.savedAt || a.updatedAt || '')) || a.key.localeCompare(b.key));
  };
  const legacy = documentId => {
    if (!validId(libraryId)) return [];
    const entries = [], draftPrefix = `paperdesk-draft-${documentId}`, archivePrefix = `paperdesk-preserved-draft-${documentId}-`;
    for (const storedKey of keys()) {
      if (storedKey === draftPrefix || storedKey.startsWith(`${draftPrefix}-`)) {
        const value = parse(local, storedKey);
        if (typeof value?.notesZh === 'string' && typeof value?.notesEn === 'string') entries.push({ key: storedKey, text: mergeNotes(value.notesZh, value.notesEn), updatedAt: value.updatedAt, unverifiedLibrary: true });
      } else if (storedKey.startsWith(archivePrefix)) {
        const value = parse(local, storedKey);
        if (typeof value?.text === 'string') entries.push({ ...value, key: storedKey, unverifiedLibrary: true });
      }
    }
    const legacyKey = `paperdesk-preserved-drafts-${documentId}`, old = parse(local, legacyKey);
    if (Array.isArray(old)) old.forEach((value, index) => {
      if (typeof value?.text === 'string') entries.push({ ...value, key: `${legacyKey}:${index}`, unverifiedLibrary: true });
    });
    return entries.sort((a, b) => String(b.savedAt || b.updatedAt || '').localeCompare(String(a.savedAt || a.updatedAt || '')) || a.key.localeCompare(b.key));
  };
  return { read, write, clear, preserve, key, pointer, legacy, history: documentId => list(documentId, false), preserved: documentId => list(documentId, true),
    matchesLibrary: id => validId(libraryId) && id === libraryId, get storageError() { return storageError; } };
}
