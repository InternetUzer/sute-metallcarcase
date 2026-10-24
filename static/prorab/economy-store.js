/* Encrypted recovery draft for the owner's single-computer economy workspace.
 * Only one tab may edit a vault. Neither passwords nor plaintext enter storage.
 */
(function (root) {
  'use strict';
  const common = typeof module !== 'undefined' && module.exports;
  const V = common ? require('./vault.js') : root.ProrabVault;
  const E = common ? require('./economy.js') : root.ProrabEconomy;
  const clone = (v) => JSON.parse(JSON.stringify(v));

  async function acquire(locks, name) {
    if (!locks || !locks.request) throw new Error('Для экономики нужен браузер с поддержкой Web Locks. Откройте кабинет в обновлённом Chrome, Edge, Firefox или Safari.');
    return new Promise((resolve, reject) => {
      locks.request('prorab-economy:' + name, { ifAvailable: true }, (lock) => {
        if (!lock) return reject(new Error('Экономика уже открыта в другой вкладке. Закройте её там и повторите.'));
        return new Promise((release) => resolve(release));
      }).catch(reject);
    });
  }

  function parse(text) {
    let file;
    try { file = JSON.parse(text); } catch (_) { throw new Error('Не удалось прочитать файл экономики. Не удаляйте его и данные браузера.'); }
    if (!V.validHeader(file) || !file.payload || !Number.isSafeInteger(file.rev) || file.rev < 1) throw new Error('Неизвестный или повреждённый формат экономики.');
    return file;
  }

  class Session {
    constructor(disk, storage, path) {
      this.disk = disk; this.storage = storage; this.path = path;
      this.draftKey = 'economy-pending:' + JSON.stringify(path);
      this.vault = null; this.data = null; this.rev = 0;
      this.queue = Promise.resolve(); this.saving = null; this.closed = false;
      this.changingCode = false; this.editing = 0;
    }
    pending() { return this.storage.get(this.draftKey); }
    write(text) {
      if (!this.storage.set(this.draftKey, text)) throw new Error('Не удалось сохранить зашифрованный черновик в браузере. Освободите место; оставьте форму открытой.');
    }
    acknowledge(text) { if (this.pending() === text) this.storage.set(this.draftKey, null); }
    active() { if (this.closed || !this.vault) throw new Error('Экономика закрыта. Войдите снова.'); }
    async unlock(secret, recovery) {
      const local = this.pending();
      let remote;
      try { remote = await this.disk.getText(this.path); }
      catch (e) { if (!local) throw e; remote = null; }
      if (local === null && remote === null) return false;
      const file = parse(local || remote);
      const vault = await V.unlock(file, secret, recovery);
      const data = await V.open(vault, file);
      E.validate(data);
      // A local encrypted draft is authoritative for unacknowledged edits and
      // password changes. Sync reads the cloud again before uploading it.
      this.vault = vault; this.data = data; this.rev = file.rev || 1;
      return true;
    }
    async initialize(vault) {
      this.vault = vault; this.data = E.empty(); this.rev = 0;
      await this.edit(() => {});
    }
    edit(change) {
      this.editing++;
      const work = this.queue.then(async () => {
        this.active();
        if (this.changingCode) throw new Error('Дождитесь завершения смены кода.');
        const next = clone(this.data);
        change(next);
        E.validate(next);
        const file = await V.seal(this.vault, next, this.rev + 1);
        this.active();
        this.write(JSON.stringify(file));
        this.data = next; this.rev = file.rev;
      });
      this.queue = work.catch(() => {});
      work.finally(() => { this.editing--; }).catch(() => {});
      return work;
    }
    async upload(text, createOnly) {
      if (createOnly) await this.disk.putBlob(this.path, new Blob([text], { type: 'application/json' }), false);
      else await this.disk.putText(this.path, text);
      // A queued upload or a lost response must not be reported as saved.
      if (await this.disk.getText(this.path) !== text) throw new Error('Диск пока не подтвердил запись. Зашифрованный черновик сохранён в этом браузере.');
    }
    sync() {
      if (this.saving) return this.saving;
      const work = this.syncNow();
      this.saving = work;
      work.finally(() => { if (this.saving === work) this.saving = null; }).catch(() => {});
      return work;
    }
    async syncNow() {
      for (;;) {
        await this.queue;
        this.active();
        const captured = this.pending();
        if (!captured) return;
        const local = parse(captured);
        const remoteText = await this.disk.getText(this.path);
        this.active();
        if (captured !== this.pending()) continue;
        let data = await V.open(this.vault, local), rev = local.rev || 1;
        if (remoteText !== null) {
          const remote = parse(remoteText);
          const theirs = await V.open(this.vault, remote);
          E.validate(theirs);
          data = E.merge(theirs, data); // always merge, even when rev numbers match
          rev = Math.max(rev, remote.rev || 1) + 1;
        }
        const text = JSON.stringify(await V.seal(this.vault, data, rev));
        this.active();
        if (captured !== this.pending()) continue;
        this.write(text); this.data = data; this.rev = rev;
        await this.upload(text, remoteText === null);
        this.acknowledge(text); // never erase a later edit made during the upload
        if (this.closed) return;
      }
    }
    async refresh() {
      if (this.pending()) return this.sync();
      if (this.saving || this.changingCode) return;
      const text = await this.disk.getText(this.path);
      this.active();
      if (text === null || this.pending()) return;
      const file = parse(text), data = await V.open(this.vault, file);
      E.validate(data);
      if (this.pending()) return;
      this.data = E.merge(data, this.data); this.rev = Math.max(this.rev, file.rev || 1);
    }
    async changeCode(code) {
      this.active();
      await this.sync();
      await this.queue;
      this.active(); this.changingCode = true;
      try {
        // Keep a recoverable copy under the old code until the new header is
        // confirmed on Disk. A failed operation never announces a new code.
        const before = JSON.stringify(await V.seal(this.vault, this.data, this.rev + 1));
        this.write(before);
        const next = { ...this.vault, header: clone(this.vault.header) };
        await V.changeCode(next, code);
        const text = JSON.stringify(await V.seal(next, this.data, this.rev + 2));
        await this.upload(text, false);
        this.vault = next; this.rev += 2;
        this.acknowledge(before);
      } finally { this.changingCode = false; }
    }
    async close() {
      // An accepted edit is encrypted locally before its form closes. Wait for
      // that short checkpoint; network errors cannot make the draft disappear.
      await this.queue;
      this.closed = true;
      this.data = null;
      if (this.vault) this.vault.raw.fill(0);
      this.vault = null;
      if (this.saving) await this.saving.catch(() => {});
    }
  }
  const api = { Session, acquire, parse };
  if (common) module.exports = api; else root.ProrabEconomyStore = api;
})(typeof window !== 'undefined' ? window : globalThis);
