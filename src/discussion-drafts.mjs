import { DISCUSSION_SCOPES, discussionDraftKey } from './discussion-state.mjs';

export const emptyDiscussionDraft = () => ({ question: '', answer: '', scope: 'selection', pages: '', reviewed: false, pending: null });
// Each window owns its slot. A reload/duplicated tab may read its session pointer,
// but writes always fork to a fresh owner and never delete the source owner's slot.
export function createDiscussionDraftStore({ libraryId, documentId, threadId, owner, local, session } = {}) {
  if (!owner) throw new Error('讨论草稿必须有窗口身份。');
  const prefix = `${discussionDraftKey(libraryId, documentId, threadId)}:owner:`;
  const key = `${prefix}${encodeURIComponent(owner)}`, pointer = `${prefix}current`;
  let failed = false, cache;
  try { if (local === undefined) local = globalThis.localStorage; if (session === undefined) session = globalThis.sessionStorage; } catch { failed = true; }
  const valid = value => {
    if (!value || typeof value !== 'object' || value.libraryId !== libraryId || value.documentId !== documentId || value.threadId !== threadId) return null;
    const draft = value.draft;
    if (!draft || typeof draft.question !== 'string' || draft.question.length > 20000 || typeof draft.answer !== 'string' || draft.answer.length > 50000
      || !Object.hasOwn(DISCUSSION_SCOPES, draft.scope) || typeof draft.pages !== 'string' || typeof draft.reviewed !== 'boolean') return null;
    if (draft.pending && (draft.pending.libraryId !== libraryId || !['user', 'assistant'].includes(draft.pending.role) || typeof draft.pending.content !== 'string'
      || typeof draft.pending.requestId !== 'string' || !Number.isSafeInteger(draft.pending.expectedRevision))) return null;
    return { ...emptyDiscussionDraft(), ...draft };
  };
  const readKey = target => { try { return valid(JSON.parse(local?.getItem(target) || 'null')); } catch { return null; } };
  return {
    key,
    get storageError() { return failed; },
    read() {
      if (cache) return cache;
      try {
        const previous = session?.getItem(pointer);
        cache = readKey(key) || (previous?.startsWith(prefix) ? readKey(previous) : null) || emptyDiscussionDraft();
      } catch { failed = true; cache = emptyDiscussionDraft(); }
      return cache;
    },
    write(draft) {
      cache = { ...draft };
      try {
        if (!local || !session) throw new Error('Storage unavailable');
        if (!draft.question && !draft.answer && !draft.pending) { local.removeItem(key); session.setItem(pointer, 'saved'); }
        else { local.setItem(key, JSON.stringify({ libraryId, documentId, threadId, draft, updatedAt: new Date().toISOString() })); session.setItem(pointer, key); }
        failed = false;
      } catch { failed = true; }
      return cache;
    },
    others() {
      const found = [];
      try {
        for (let index = 0; index < (local?.length || 0); index++) {
          const target = local.key(index);
          if (target !== key && target?.startsWith(prefix)) { const draft = readKey(target); if (draft && (draft.question || draft.answer || draft.pending)) found.push({ key: target, ...draft }); }
        }
      } catch { failed = true; }
      return found;
    },
  };
}
