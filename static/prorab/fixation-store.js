/* Durable snapshot upload and receipt verification; captures one Disk/account session. */
(function (root) {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports;
  const F = node ? require('./fixation.js') : root.ProrabFixation;
  const DS = node ? require('./document-store.js') : root.ProrabDocumentStore;
  const enc = new TextEncoder();
  class Journal {
    constructor({ disk, path, device, project, storage, request }) {
      DS.leaf(device);
      Object.assign(this, { disk, path, device, project, storage, request, loaded: false, seals: [], anchored: new Set(), lastAt: 0, busy: false });
      this.dir = path + '/' + F.DIR;
      this.io = new DS.Store(disk, this.dir + '/' + device);
      this.pendingKey = 'fixation.pending:' + path + ':' + device;
    }
    pending() {
      let files;
      try { files = JSON.parse(this.storage.get(this.pendingKey) || '[]'); } catch (_) { throw new Error('Повреждён список файлов для фиксации. Не очищайте данные браузера.'); }
      if (!Array.isArray(files)) throw new Error('Повреждён список файлов для фиксации.');
      for (const f of files) { F.filePath(f.name); if (!/^[0-9a-f]{64}$/.test(f.sha256)) throw new Error('Повреждён отпечаток файла.'); }
      return files;
    }
    async queueFile(name, bytes) {
      F.filePath(name);
      const sha256 = await F.sha256(bytes);
      const next = this.pending().filter((f) => f.name !== name).concat({ name, sha256 });
      if (!this.storage.set(this.pendingKey, JSON.stringify(next))) throw new Error('Файл сохранён, но очередь фиксации не записана в браузере. Проверьте доступное место.');
    }
    async readChain(device) {
      DS.leaf(device);
      const dir = this.dir + '/' + device;
      const items = (await this.disk.list(dir)) || [], seals = [], anchors = new Map();
      for (const it of items.filter((f) => f.type === 'file' && f.name.endsWith('.json'))) {
        if (!/^\d{6,12}(\.anchor)?\.json$/.test(it.name)) throw new Error('Неизвестный файл в цепочке: ' + it.name);
        const text = await this.disk.getText(dir + '/' + it.name);
        if (text === null) throw new Error('Файл фиксации исчез при чтении: ' + it.name);
        let value;
        try { value = JSON.parse(text); } catch (_) { throw new Error('Повреждён файл фиксации: ' + it.name); }
        if (!value || value.seq !== Number(it.name.split('.')[0])) throw new Error('Номер внутри фиксации не совпадает с именем: ' + it.name);
        if (it.name.includes('.anchor.')) anchors.set(value.seq, value);
        else { if (value.device !== device || value.project !== this.project) throw new Error('Чужой объект или устройство в файле ' + it.name); seals.push(value); }
      }
      seals.sort((a, b) => a.seq - b.seq);
      return { device, seals, anchors };
    }
    async load() {
      const chain = await this.readChain(this.device);
      const result = await F.verifyChain(chain.seals, chain.anchors);
      if (result.problems.length) throw new Error(result.problems.join('; '));
      this.seals = chain.seals; this.anchors = chain.anchors;
      this.leaves = F.replay(this.seals); this.anchored = new Set(chain.anchors.keys());
      this.lastAt = this.seals.length ? this.seals.at(-1).createdAt : 0;
      this.loaded = true; return this;
    }
    async anchor(seal) {
      const receipt = await this.request('', { project: await F.projectKey(this.project), chain: await F.chainKey(this.project, this.device), seq: String(seal.seq), prev: seal.prev || '', hash: seal.hash });
      if (receipt.version !== 2 || receipt.hash !== seal.hash || receipt.seq !== seal.seq || receipt.chain !== await F.chainKey(this.project, this.device)) throw new Error('Сервер вернул квитанцию другой фиксации.');
      await this.io.json(this.io.path + '/' + F.anchorName(seal.seq), receipt);
      this.anchors.set(seal.seq, receipt); this.anchored.add(seal.seq);
    }
    async capture(state, { force = false, now = Date.now() } = {}) {
      if (this.busy) return 'Фиксация уже идёт';
      this.busy = true;
      // Freeze before Disk operations; concurrent edits belong to the next snapshot.
      try {
        const snapshot = JSON.parse(JSON.stringify(state));
        return await this.io.run(async () => {
          await this.load();
          let known = null;
          try { known = await this.request('/heads', { project: await F.projectKey(this.project) }); } catch (_) { /* offline snapshots may still be saved */ }
          if (known) {
            if (!Array.isArray(known.heads)) throw new Error('Неполный ответ серверного реестра.');
            const chain = await F.chainKey(this.project, this.device), head = known.heads.find((h) => h.chain === chain);
            if (head && !this.seals.some((s) => s.seq === head.seq && s.hash === head.hash)) throw new Error('Последняя подтверждённая фиксация отсутствует или изменена на Диске. Восстановите её из корзины или резервной копии.');
          }
          let receiptError = null;
          for (const seal of this.seals) if (!this.anchored.has(seal.seq)) {
            try { await this.anchor(seal); } catch (e) { receiptError = e; break; }
          }
          if (!force && now - this.lastAt < 30 * 60 * 1000) {
            if (receiptError) throw new Error('Есть сохранённые снимки без квитанции: ' + receiptError.message);
            return null;
          }
          const files = this.pending();
          const res = await F.makeSeal(this.seals.at(-1) || null, this.leaves, snapshot, { project: this.project, device: this.device, now, files });
          if (!res) {
            if (receiptError) throw new Error('Есть сохранённые снимки без квитанции: ' + receiptError.message);
            return 'Изменений с прошлой фиксации нет';
          }
          await this.disk.mkdir(this.dir); await this.disk.mkdir(this.io.path);
          await this.io.file(this.io.path + '/' + F.name(res.seal.seq), enc.encode(JSON.stringify(res.seal)));
          this.seals.push(res.seal); this.leaves = res.leaves; this.lastAt = now;
          // A new upload of the same name during saving must remain queued.
          const pending = this.pending().filter((f) => !files.some((sent) => sent.name === f.name && sent.sha256 === f.sha256));
          if (!this.storage.set(this.pendingKey, JSON.stringify(pending))) throw new Error('Снимок сохранён; не удалось подтвердить очередь браузера. Повторите фиксацию.');
          try { await this.anchor(res.seal); }
          catch (e) { throw new Error('Снимок № ' + res.seal.seq + ' сохранён на Диске, квитанция не получена: ' + e.message); }
          return 'Зафиксировано: № ' + res.seal.seq + ', квитанция сервера получена';
        });
      } finally { this.busy = false; }
    }
    async all() {
      const dirs = ((await this.disk.list(this.dir)) || []).filter((d) => d.type === 'dir');
      const chains = [];
      for (const d of dirs) chains.push(await this.readChain(d.name));
      return chains;
    }
    async report(state) {
      const raw = await this.all(), chains = [], issues = [], notes = [];
      let valid = 0, invalid = 0, checked = false;
      const project = await F.projectKey(this.project);
      for (const ch of raw) {
        const row = await F.verifyChain(ch.seals, ch.anchors);
        const chain = await F.chainKey(this.project, ch.device);
        for (const a of ch.anchors.values()) {
          if (a.version === 1) notes.push('Старая квитанция устройства ' + ch.device + ': подтверждён отпечаток, но удаление конца цепочки этим протоколом не проверяется. Обновите приложение телефона.');
          else if (a.project !== project || a.chain !== chain) row.problems.push('Квитанция относится к другому объекту или устройству');
        }
        const named = (ch.seals.find((s) => s && s.deviceName) || {}).deviceName;
        const label = ch.device === this.device ? 'Это устройство' : named ? 'Телефон ' + named : /^web-/.test(ch.device) ? 'Кабинет' : 'Устройство ' + ch.device.slice(0, 8);
        chains.push({ ...row, device: ch.device, label, chain });
      }
      try {
        const receipts = raw.flatMap((ch) => Array.from(ch.anchors.values()));
        for (let i = 0; i < receipts.length; i += 100) {
          const batch = receipts.slice(i, i + 100), res = await this.request('/verify', { receipts: JSON.stringify(batch) });
          if (!Array.isArray(res.valid) || res.valid.length !== batch.length) throw new Error('Неполный ответ проверки квитанций.');
          for (const ok of res.valid) { if (ok === true) valid++; else invalid++; }
        }
        const { heads } = await this.request('/heads', { project });
        if (!Array.isArray(heads)) throw new Error('Серверный реестр недоступен.');
        for (const head of heads) {
          const row = chains.find((r) => r.chain === head.chain);
          if (!row) { issues.push('На Диске отсутствует цепочка, зарегистрированная сервером: ' + head.chain.slice(0, 12)); continue; }
          const ch = raw.find((r) => r.device === row.device), seal = ch.seals.find((s) => s.seq === head.seq);
          if (!seal || seal.hash !== head.hash) issues.push('Сервер хранит другую или удалённую фиксацию № ' + head.seq + ' устройства ' + ch.device);
        }
        for (const ch of raw) {
          const id = await F.chainKey(this.project, ch.device), head = heads.find((h) => h.chain === id);
          if (ch.seals.length && (!head || head.seq < ch.seals.at(-1).seq)) notes.push('Есть снимки без подтверждения сервера: ' + ch.device);
        }
        checked = true;
      } catch (e) { notes.push('Серверная проверка не завершена: ' + e.message); }
      if (!raw.some((ch) => ch.seals.length)) notes.push('Нет снимков для проверки.');
      // Compare current files with the latest recorded fingerprints; do not call a difference a forgery.
      const files = new Map();
      const seals = raw.flatMap((ch) => ch.seals.map((s) => ({ seal: s, at: Date.parse((ch.anchors.get(s.seq) || {}).time) || s.createdAt }))).sort((a, b) => a.at - b.at || a.seal.seq - b.seal.seq);
      for (const { seal } of seals) for (const f of seal.files) { F.filePath(f.name); files.set(f.name, f.sha256); }
      let verifiedFiles = 0;
      for (const [name, hash] of files) {
        try {
          const bytes = await this.disk.getBytes(this.path + '/' + name);
          if (!bytes) issues.push('Файл отсутствует: ' + name);
          else if (await F.sha256(bytes) !== hash) issues.push('Файл отличается от последней фиксации: ' + name);
          else verifiedFiles++;
        } catch (e) { notes.push('Не удалось проверить файл ' + name + ': ' + e.message); }
      }
      if (state && seals.length && await F.rootOf(await F.leaves(JSON.parse(JSON.stringify(state)))) !== seals.at(-1).seal.root) notes.push('Текущие данные отличаются от последнего снимка. Зафиксируйте новые изменения после синхронизации.');
      return { chains, raw, anchors: { valid, invalid, checked }, issues, notes, verifiedFiles, fileCount: files.size,
        incomplete: notes.length > 0 || !checked, problems: issues.length > 0 || chains.some((r) => r.problems.length) || invalid > 0, at: Date.now() };
    }
  }
  const api = { Journal };
  if (node) module.exports = api; else root.ProrabFixationStore = api;
})(typeof window !== 'undefined' ? window : globalThis);
