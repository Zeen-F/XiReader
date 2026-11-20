import assert from 'node:assert/strict';
import test from 'node:test';
import { createNoteDraftStore } from '../src/note-drafts.mjs';
import { MAX_NOTE_LENGTH } from '../shared/notes.mjs';

class MemoryStorage {
  constructor(source) { this.items = new Map(source?.items); this.failWrites = false; }
  get length() { return this.items.size; }
  key(index) { return [...this.items.keys()][index] ?? null; }
  getItem(key) { return this.items.get(String(key)) ?? null; }
  setItem(key, value) { if (this.failWrites) throw new Error('Synthetic storage failure'); this.items.set(String(key), String(value)); }
  removeItem(key) { if (this.failWrites) throw new Error('Synthetic storage failure'); this.items.delete(String(key)); }
}
const documentId = 'b2ce41c4-39e0-4ccb-a9d7-1cd1cb951380';
const baseRevision = 'same-synthetic-note-revision';
function setup({ libraryId = 'synthetic-library-a', owner = 'window-a', local = new MemoryStorage(), session = new MemoryStorage() } = {}) {
  return { local, session, store: createNoteDraftStore({ libraryId, owner, local, session }) };
}

test('unconfirmed library identity cannot read, list or write a note draft', () => {
  const { store } = setup({ libraryId: null });
  assert.equal(store.read(documentId), null);
  assert.deepEqual(store.history(documentId), []);
  assert.deepEqual(store.preserved(documentId), []);
  assert.deepEqual(store.legacy(documentId), []);
  assert.equal(store.matchesLibrary(null), false);
  assert.throws(() => store.write(documentId, 'Must not persist', baseRevision), /文献库/);
  assert.throws(() => store.preserve(documentId, 'Must not archive', baseRevision), /文献库/);
});

test('same document and revision in two synthetic libraries never recover or list each other drafts', () => {
  const a = setup();
  const written = a.store.write(documentId, 'Unsaved note belonging only to library A', baseRevision);
  a.store.preserve(documentId, 'Preserved only in library A', baseRevision);
  const b = setup({ libraryId: 'synthetic-library-b', owner: 'window-b', local: a.local, session: a.session });
  assert.equal(b.store.read(documentId), null, 'B must not auto-resume a draft merely because the note revision matches');
  assert.deepEqual(b.store.history(documentId), []);
  assert.deepEqual(b.store.preserved(documentId), []);
  b.store.write(documentId, 'Unsaved note belonging only to library B', baseRevision);
  const reopenedA = setup({ owner: 'reopened-a', local: a.local, session: a.session });
  assert.equal(reopenedA.store.read(documentId).text, written.text);
  assert.equal(reopenedA.store.read(documentId).baseRevision, baseRevision);
  assert.deepEqual(reopenedA.store.history(documentId).map(value => value.text), [written.text]);
  assert.equal(reopenedA.store.preserved(documentId)[0].text, 'Preserved only in library A');
  assert.equal(a.store.matchesLibrary('synthetic-library-b'), false);
});

test('a window-local recovery pointer cannot cross a library or document namespace', () => {
  const a = setup(), original = a.store.write(documentId, 'Only A', baseRevision);
  for (const [libraryId, otherDocument] of [['synthetic-library-b', documentId], ['synthetic-library-a', 'f95bf247-2d57-4de1-b6ab-cf0caed36612']]) {
    const other = setup({ libraryId, owner: 'window-b', local: a.local, session: new MemoryStorage() });
    other.session.setItem(other.store.pointer(otherDocument), original.key);
    assert.equal(other.store.read(otherDocument), null);
  }
});

test('the payload identity and owner must agree with its namespace key even if a pointer is forged', () => {
  const first = setup(), saved = first.store.write(documentId, 'Scoped draft', baseRevision);
  const raw = JSON.parse(first.local.getItem(saved.key));
  for (const invalid of ['{broken JSON', JSON.stringify({ ...raw, libraryId: 'synthetic-library-b' }),
    JSON.stringify({ ...raw, documentId: 'other-document' }), JSON.stringify({ ...raw, owner: 'unrelated-owner' }),
    JSON.stringify({ ...raw, schema: 'wrong-schema' }), JSON.stringify({ ...raw, text: 42 }),
    JSON.stringify({ ...raw, generation: '' }), JSON.stringify({ ...raw, baseRevision: {} })]) {
    const local = new MemoryStorage(first.local); local.setItem(saved.key, invalid);
    const reloaded = setup({ local, session: new MemoryStorage(first.session), owner: 'reload' });
    assert.equal(reloaded.store.read(documentId), null);
    assert.deepEqual(reloaded.store.history(documentId), []);
  }
});

test('duplicated tabs may inherit a draft but independent writes and clears never erase the source owner', () => {
  const a = setup(), inherited = a.store.write(documentId, 'Before duplication', baseRevision);
  const b = setup({ local: a.local, session: new MemoryStorage(a.session), owner: 'window-b' });
  assert.equal(b.store.read(documentId).key, inherited.key);
  assert.equal(b.store.clear(documentId, inherited.text), true);
  assert.notEqual(a.local.getItem(inherited.key), null, 'Clearing inherited content does not remove another live window slot');
  assert.equal(a.store.read(documentId).text, inherited.text);
  const reloadB = setup({ local: a.local, session: b.session, owner: 'reloaded-b' });
  assert.equal(reloadB.store.read(documentId), null);
  assert.equal(reloadB.store.history(documentId)[0].text, inherited.text);
  const ownA = a.store.write(documentId, 'A keeps typing', baseRevision);
  const ownB = b.store.write(documentId, 'B keeps typing', baseRevision);
  assert.notEqual(ownA.key, ownB.key);
  assert.equal(b.store.clear(documentId, ownB.text), true);
  assert.equal(a.store.read(documentId).text, ownA.text);
  assert.notEqual(a.local.getItem(ownA.key), null);
  assert.equal(a.local.getItem(ownB.key), null);
});

test('a successful older snapshot never clears typing that continued during the save', () => {
  const { store, local } = setup();
  const old = store.write(documentId, 'Submitted B', baseRevision);
  const latest = store.write(documentId, 'Newest A', baseRevision);
  assert.equal(store.clear(documentId, old.text), false);
  assert.equal(store.read(documentId).text, latest.text);
  const rebased = store.write(documentId, latest.text, 'acknowledged-new-revision');
  assert.equal(store.read(documentId).baseRevision, 'acknowledged-new-revision');
  assert.equal(store.clear(documentId, latest.text), true);
  assert.equal(store.read(documentId), null);
  assert.equal(local.getItem(rebased.key), null);
});

test('unscoped legacy drafts and archives are preview-only and remain byte-for-byte unchanged', () => {
  const first = setup(), legacyKey = `paperdesk-draft-${documentId}`;
  const zh = ' \t## 中文\r\nEvidence 🧪\n', en = '\nEnglish  \n';
  first.local.setItem(legacyKey, JSON.stringify({ notesZh: zh, notesEn: en, baseRevision }));
  first.local.setItem(`${legacyKey}-old-window`, JSON.stringify({ notesZh: 'Historical v1', notesEn: '' }));
  first.local.setItem(`paperdesk-preserved-draft-${documentId}-archive`, JSON.stringify({ text: 'Old independent archive' }));
  first.local.setItem(`paperdesk-preserved-drafts-${documentId}`, JSON.stringify([{ text: 'Old array archive' }]));
  first.session.setItem(`paperdesk-draft-slot-${documentId}`, legacyKey);
  const beforeLocal = new Map(first.local.items), beforeSession = new Map(first.session.items);
  assert.equal(first.store.read(documentId), null, 'A matching v1 base revision does not grant library ownership');
  assert.deepEqual(first.store.history(documentId), []);
  assert.deepEqual(first.store.preserved(documentId), []);
  const candidates = first.store.legacy(documentId);
  assert.equal(candidates.length, 4);
  assert.equal(candidates.find(value => value.key === legacyKey).text, `${zh}\n\n---\n\n${en}`);
  assert.ok(candidates.every(value => value.unverifiedLibrary));
  assert.deepEqual(first.local.items, beforeLocal); assert.deepEqual(first.session.items, beforeSession);
  first.store.write(documentId, candidates[0].text, baseRevision);
  first.store.clear(documentId, candidates[0].text);
  for (const [key, value] of beforeLocal) assert.equal(first.local.getItem(key), value, 'Explicitly saving matching content never deletes v1 records');
});

test('other-window history is read-only and does not become an active draft', () => {
  const first = setup(); first.store.write(documentId, 'Another window', baseRevision);
  first.store.preserve(documentId, 'Archived conflict', baseRevision);
  const fresh = setup({ local: first.local, session: new MemoryStorage(), owner: 'independent-window' });
  const before = new Map(first.local.items);
  assert.equal(fresh.store.read(documentId), null);
  assert.equal(fresh.store.history(documentId)[0].text, 'Another window');
  assert.equal(fresh.store.preserved(documentId)[0].text, 'Archived conflict');
  assert.equal(fresh.store.read(documentId), null);
  assert.deepEqual(first.local.items, before);
});

test('failed local and session writes retain latest memory-only text and report recovery limits', () => {
  for (const target of ['local', 'session']) {
    const fixture = setup(); fixture.store.write(documentId, 'Old persisted text', baseRevision);
    fixture[target].failWrites = true;
    assert.throws(() => fixture.store.write(documentId, 'Latest memory text', baseRevision), /Synthetic/);
    assert.equal(fixture.store.storageError, true);
    assert.equal(fixture.store.read(documentId).text, 'Latest memory text');
    fixture[target].failWrites = false;
    fixture.store.write(documentId, 'Latest memory text', baseRevision);
    assert.equal(fixture.store.storageError, false);
  }
});

test('conflict recovery cannot replace editor content until the actual memory-only draft is archived', () => {
  const fixture = setup(); fixture.store.write(documentId, 'Old persisted draft', baseRevision);
  fixture.local.failWrites = true;
  assert.throws(() => fixture.store.write(documentId, 'Latest conflict text', baseRevision));
  assert.throws(() => fixture.store.preserve(documentId, 'Latest conflict text', baseRevision));
  assert.equal(fixture.store.read(documentId).text, 'Latest conflict text');
  fixture.local.failWrites = false;
  fixture.store.preserve(documentId, 'Latest conflict text', baseRevision);
  assert.equal(fixture.store.clear(documentId, 'Latest conflict text'), true);
  assert.equal(fixture.store.preserved(documentId)[0].text, 'Latest conflict text');
  const sameRuntimeRemount = setup({ local: fixture.local, session: fixture.session });
  assert.equal(sameRuntimeRemount.store.read(documentId), null, 'A saved pointer prevents stale disk text from becoming active after remount');
  assert.equal(sameRuntimeRemount.store.history(documentId)[0].text, 'Old persisted draft', 'Unsubmitted old disk content remains available only as history');
});

test('storage accessor denial never crashes reading and does not lose in-memory edits', () => {
  const names = ['localStorage', 'sessionStorage'], descriptors = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  try {
    for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, get() { throw new Error('Synthetic storage denial'); } });
    const store = createNoteDraftStore({ libraryId: 'synthetic-library-a', owner: 'denied-storage' });
    assert.equal(store.read(documentId), null);
    assert.deepEqual(store.history(documentId), []);
    assert.deepEqual(store.legacy(documentId), []);
    assert.throws(() => store.write(documentId, 'Still in editor memory', baseRevision));
    assert.equal(store.read(documentId).text, 'Still in editor memory');
    assert.equal(store.storageError, true);
  } finally {
    names.forEach((name, index) => { if (descriptors[index]) Object.defineProperty(globalThis, name, descriptors[index]); else delete globalThis[name]; });
  }
});

test('scope encoding has no separator collisions and damaged slots do not hide valid archives', () => {
  const a = setup({ libraryId: 'library:a', owner: 'window:a' }), b = setup({ libraryId: 'library', owner: 'window:a' });
  assert.notEqual(a.store.key('document'), b.store.key('a:document'));
  const bad = a.store.preserve(documentId, 'Damaged archive', baseRevision);
  a.local.setItem(bad.key, '{broken JSON');
  a.store.preserve(documentId, 'Valid archive', baseRevision);
  assert.deepEqual(a.store.preserved(documentId).map(value => value.text), ['Valid archive']);
  assert.throws(() => a.store.write(documentId, 'x'.repeat(MAX_NOTE_LENGTH + 1), baseRevision), /格式/);
});
