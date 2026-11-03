/* Account-scoped recovery drafts and one writer file per active browser tab. */
(function (root) {
  'use strict';
  const S = typeof module !== 'undefined' && module.exports ? require('./sync.js') : root.ProrabSync;

  function storage(raw, prefix) {
    return {
      get(k) { try { return raw.getItem(prefix + k); } catch (_) { return null; } },
      set(k, value) {
        try {
          if (value === null || value === undefined) raw.removeItem(prefix + k);
          else raw.setItem(prefix + k, value);
          return true;
        } catch (_) { return false; }
      },
      json(k, fallback) { try { return JSON.parse(this.get(k)) || fallback; } catch (_) { return fallback; } },
      keys() {
        const keys = [];
        try { for (let i = 0; i < raw.length; i++) { const k = raw.key(i); if (k && k.startsWith(prefix)) keys.push(k.slice(prefix.length)); } } catch (_) { /* unavailable */ }
        return keys;
      },
    };
  }

  function accountStorage(raw, prefix, uid) {
    if (!uid || typeof uid !== 'string') throw new Error('Яндекс Диск не вернул идентификатор аккаунта. Войдите заново.');
    return storage(raw, prefix + 'account:' + encodeURIComponent(uid) + ':');
  }

  // Locks reserve stable writer slots. Reloading a closed tab reuses its slot; a second
  // simultaneous tab uses a different file. Without Web Locks use a fresh UUID, never
  // the shared localStorage device id (two tabs would overwrite each other's records).
  async function acquireWriter(store, locks) {
    let base = store.get('device');
    if (!base) { base = 'web-' + S.newId(); store.set('device', base); }
    if (locks && locks.request) {
      for (let slot = 0; slot < 32; slot++) {
        const id = base + '-' + slot;
        let release = () => {};
        const acquired = await new Promise((resolve) => {
          locks.request('prorab-writer:' + id, { ifAvailable: true }, (lock) => {
            if (!lock) { resolve(false); return; }
            return new Promise((done) => { release = done; resolve(true); });
          }).catch(() => resolve(false));
        });
        if (acquired) return { id, release };
      }
    }
    return { id: 'web-' + S.newId(), release() {} };
  }

  class Drafts {
    constructor(store, path, projectId, writer) {
      this.store = store;
      this.projectId = projectId;
      this.prefix = 'pending:' + JSON.stringify([path, projectId]) + ':';
      this.key = this.prefix + writer;
    }
    write(file) { return this.store.set(this.key, JSON.stringify(file)); }
    read() {
      const snapshots = [];
      for (const key of this.store.keys().filter((k) => k.startsWith(this.prefix))) {
        const text = this.store.get(key);
        let file;
        try { file = JSON.parse(text); } catch (_) { throw new Error('Не удалось прочитать сохранённые правки этого объекта. Не очищайте данные браузера.'); }
        if (!S.validFile(file) || file.projectId !== this.projectId) throw new Error('Неизвестный формат сохранённых правок объекта.');
        snapshots.push({ key, text, file });
      }
      return snapshots;
    }
    // An upload acknowledges exactly its input. Never erase a newer draft made while
    // the request was in flight (including in another tab).
    acknowledge(snapshots) {
      for (const { key, text } of snapshots) if (this.store.get(key) === text) this.store.set(key, null);
    }
  }

  const api = { storage, accountStorage, acquireWriter, Drafts };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ProrabPersistence = api;
})(typeof window !== 'undefined' ? window : globalThis);
