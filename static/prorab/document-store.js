/* Captured Disk session, verified uploads and immutable generated document versions. */
(function (root) {
  'use strict';
  const I = typeof module !== 'undefined' && module.exports ? require('./id.js') : root.ProrabId;
  const copy = (v) => JSON.parse(JSON.stringify(v));
  const leaf = (name) => {
    if (typeof name !== 'string' || !name || name === '.' || name === '..' || /[\\/\x00-\x1f]/.test(name)) throw new Error('Недопустимое имя документа.');
    return name;
  };
  class Store {
    constructor(disk, path) { this.disk = disk; this.path = path; this.busy = false; }
    async run(work) {
      if (this.busy) throw new Error('Дождитесь завершения сохранения документов.');
      this.busy = true;
      try {
        const locks = root.navigator && root.navigator.locks;
        if (locks) return await locks.request('prorab:documents:' + this.path, { mode: 'exclusive', ifAvailable: true }, async (lock) => {
          if (!lock) throw new Error('Документы сейчас сохраняются в другой вкладке. Дождитесь завершения и обновите список.');
          return work();
        });
        return await work();
      } finally { this.busy = false; }
    }
    async json(path, value) {
      const text = JSON.stringify(value, null, 1);
      await this.disk.putText(path, text);
      if (await this.disk.getText(path) !== text) throw new Error('Диск не подтвердил сохранение данных. Повторите после восстановления связи.');
      if (this.onVerified) await this.onVerified(path, new TextEncoder().encode(text));
    }
    async file(path, bytes) {
      await this.disk.putBlob(path, new Blob([bytes]), false);
      const read = await this.disk.getBytes(path);
      const got = read && new Uint8Array(read);
      if (!got || got.length !== bytes.length || !got.every((n, i) => n === bytes[i])) throw new Error('Диск не подтвердил сохранение файла. Прежние версии сохранены.');
      if (this.onVerified) await this.onVerified(path, bytes);
    }
    async participants(value) {
      return this.run(async () => {
        I.validateParticipants(value);
        await this.disk.mkdir(this.path);
        const path = this.path + '/участники.json';
        const text = await this.disk.getText(path);
        const old = text === null ? I.emptyParticipants() : I.validateParticipants(JSON.parse(text));
        const merged = copy(I.mergeParticipants(old, value));
        await this.json(path, merged);
        return merged;
      });
    }
    async records(folder) {
      const dir = this.path + '/' + leaf(folder);
      const files = (await this.disk.list(dir)) || [];
      const records = [];
      for (const f of files.filter((x) => x.type === 'file' && x.name.endsWith('.json'))) {
        const text = await this.disk.getText(dir + '/' + leaf(f.name));
        if (text === null) throw new Error('Файл исчез при чтении: ' + f.name);
        let row;
        try { row = JSON.parse(text); } catch (_) { throw new Error('Повреждён документ ' + f.name + '. Обновление остановлено.'); }
        if (!row || typeof row.id !== 'string' || f.name !== row.id + '.json') throw new Error('Повреждён реестр документов: ' + f.name);
        leaf(row.id); if (row.docx) leaf(row.docx); if (row.ks3) leaf(row.ks3);
        records.push(row);
      }
      return records;
    }
    async act(act, participants, project, bytes) {
      return this.run(async () => {
        const dir = this.path + '/АОСР';
        leaf(act.id);
        const all = await this.records('АОСР');
        const prior = all.find((x) => x.id === act.id);
        if (all.some((x) => x.id !== act.id && String(x.number) === String(act.number))) throw new Error('Этот номер АОСР уже занят. Обновите список.');
        if (prior && prior.updatedAt !== act.updatedAt) throw new Error('Акт уже изменён. Закройте форму и обновите список.');
        if (prior && prior.signed && JSON.stringify(prior) !== JSON.stringify(act)) throw new Error('Подписанный акт сохранён. Для исправлений создайте новый акт с новым номером.');
        const revision = (root.crypto || globalThis.crypto).randomUUID();
        const name = I.fileName(act).replace(/\.docx$/, ' — ' + revision + '.docx');
        await this.disk.mkdir(this.path); await this.disk.mkdir(dir);
        await this.file(dir + '/' + name, bytes);
        const saved = Object.assign(copy(act), { docx: name, updatedAt: Date.now(), participantsSnapshot: copy(participants), projectSnapshot: copy(project) });
        await this.json(dir + '/' + act.id + '.json', saved);
        return saved;
      });
    }
    async generated(folder, files, record) {
      return this.run(async () => {
        const dir = this.path + '/' + leaf(folder);
        if (record && folder === 'КС') {
          I.validateCertificate(record);
          const records = await this.records('КС');
          if (records.some((r) => r.id === record.id)) throw new Error('Этот комплект уже сохранён. Обновите список.');
          const ledger = I.certificateLedger(records, record);
          if (record.status === 'draft' && JSON.stringify(ledger) !== JSON.stringify(record.ledger)) throw new Error('Реестр КС изменился. Обновите список и сформируйте комплект снова.');
        }
        await this.disk.mkdir(this.path); await this.disk.mkdir(dir);
        for (const f of files) await this.file(dir + '/' + leaf(f.name), f.bytes);
        if (record) await this.json(dir + '/' + leaf(record.id) + '.json', record);
        return files.map((f) => f.name);
      });
    }
    async issue(record) {
      return this.run(async () => {
        const path = this.path + '/КС/' + leaf(record.id) + '.json';
        const text = await this.disk.getText(path);
        if (!text) throw new Error('КС-2 не найдена. Обновите список.');
        const saved = JSON.parse(text);
        I.validateCertificate(saved);
        if (saved.status === 'issued') return saved;
        const all = await this.records('КС');
        const ledger = I.certificateLedger(all, saved);
        if (JSON.stringify(ledger) !== JSON.stringify(saved.ledger)) throw new Error('Накопление изменилось после формирования. Создайте новый комплект КС перед подачей.');
        saved.status = 'issued'; saved.issuedAt = Date.now();
        await this.json(path, saved);
        return saved;
      });
    }
  }
  const api = { Store, leaf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ProrabDocumentStore = api;
})(typeof window !== 'undefined' ? window : globalThis);
