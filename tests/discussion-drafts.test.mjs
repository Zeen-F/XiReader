import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiscussionDraftStore, emptyDiscussionDraft } from '../src/discussion-drafts.mjs';
const storage = () => { const values = new Map(); return { get length() { return values.size; }, key: index => [...values.keys()][index] ?? null, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }; };
const scope = { libraryId: 'library-a', documentId: 'doc-a', threadId: 'thread-a' };
const content = question => ({ ...emptyDiscussionDraft(), question });
test('two windows cannot overwrite or clear each other’s same-thread draft', () => {
  const local = storage();
  const first = createDiscussionDraftStore({ ...scope, owner: 'one', local, session: storage() });
  const second = createDiscussionDraftStore({ ...scope, owner: 'two', local, session: storage() });
  first.write(content('first unsaved question')); second.write(content('second unsaved question'));
  assert.notEqual(first.key, second.key);
  first.write(emptyDiscussionDraft());
  assert.equal(second.read().question, 'second unsaved question');
  assert.match(local.getItem(second.key), /second unsaved question/);
  assert.equal(local.getItem(first.key), null);
});
test('reload or duplicated tab reads session recovery but forks on write and never clears source', () => {
  const local = storage(), session = storage();
  const first = createDiscussionDraftStore({ ...scope, owner: 'original', local, session }); first.write(content('original'));
  const restored = createDiscussionDraftStore({ ...scope, owner: 'reloaded', local, session });
  assert.equal(restored.read().question, 'original');
  restored.write(content('edited after reload')); restored.write(emptyDiscussionDraft());
  assert.match(local.getItem(first.key), /original/);
  assert.equal(restored.others()[0].question, 'original');
});
test('quota failure preserves in-memory input and immutable pending attempt', () => {
  const local = storage(); local.setItem = () => { throw new Error('quota'); };
  const store = createDiscussionDraftStore({ ...scope, owner: 'one', local, session: storage() });
  const pending = { libraryId: scope.libraryId, expectedRevision: 0, requestId: 'fixed-request', role: 'user', content: 'question' };
  store.write({ ...content('question'), pending });
  assert.equal(store.storageError, true);
  assert.equal(store.read().question, 'question');
  assert.equal(store.read().pending.requestId, 'fixed-request');
});
test('same document/thread in another library cannot recover or enumerate prior library input', () => {
  const local = storage(), session = storage();
  createDiscussionDraftStore({ ...scope, owner: 'one', local, session }).write(content('library a only'));
  const second = createDiscussionDraftStore({ ...scope, libraryId: 'library-b', owner: 'one', local, session });
  assert.equal(second.read().question, ''); assert.deepEqual(second.others(), []);
});
