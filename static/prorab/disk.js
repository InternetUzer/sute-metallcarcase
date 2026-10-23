/* «Прораб+» в браузере — Яндекс Диск (REST API) из браузера, с ключом владельца. */
(function (root) {
  'use strict';
  const API = 'https://cloud-api.yandex.net/v1/disk';

  class DiskError extends Error {
    constructor(message, status) { super(message); this.status = status; }
  }

  /** Путь в форме телефона «/Папка/Объект» → «disk:/Папка/Объект». */
  const normalize = (p) => '/' + String(p || '').split('/').filter((s) => s.trim()).join('/');
  const diskPath = (p) => 'disk:' + normalize(p);

  class Disk {
    constructor(token) { this.token = token; }

    async call(method, path, query, opts) {
      const qs = new URLSearchParams(query || {}).toString();
      let r;
      try {
        r = await fetch(API + path + (qs ? '?' + qs : ''), Object.assign({ method, headers: { Authorization: 'OAuth ' + this.token } }, opts || {}));
      } catch (e) {
        throw new DiskError('Нет связи с Яндекс Диском. Проверьте интернет.', 0);
      }
      if (r.status === 401) throw new DiskError('Ключ Яндекс Диска не подходит или устарел — войдите заново.', 401);
      return r;
    }

    async user() {
      const r = await this.call('GET', '');
      if (!r.ok) throw new DiskError('Яндекс Диск ответил ' + r.status, r.status);
      const j = await r.json();
      return (j.user && (j.user.display_name || j.user.login)) || '';
    }

    /** Содержимое папки: [{ name, type: 'dir'|'file', path, modified, size, md5 }] или null, если папки нет. */
    async list(path) {
      const out = [];
      let offset = 0;
      for (;;) {
        const r = await this.call('GET', '/resources', { path: diskPath(path), limit: 1000, offset, fields: '_embedded.items.name,_embedded.items.type,_embedded.items.path,_embedded.items.modified,_embedded.items.size,_embedded.items.md5,_embedded.total' });
        if (r.status === 404) return null;
        if (!r.ok) throw new DiskError('Не удалось открыть папку (' + r.status + ')', r.status);
        const e = (await r.json())._embedded || {};
        const items = e.items || [];
        out.push(...items);
        offset += items.length;
        if (!items.length || offset >= (e.total || 0)) break;
      }
      return out;
    }

    async getText(path) {
      const r = await this.call('GET', '/resources/download', { path: diskPath(path) });
      if (r.status === 404) return null;
      if (!r.ok) throw new DiskError('Не удалось скачать ' + path + ' (' + r.status + ')', r.status);
      const { href } = await r.json();
      const d = await fetch(href);
      if (!d.ok) throw new DiskError('Не удалось скачать ' + path + ' (' + d.status + ')', d.status);
      return d.text();
    }

    async putText(path, text) {
      const r = await this.call('GET', '/resources/upload', { path: diskPath(path), overwrite: 'true' });
      if (r.status === 409) throw new DiskError('Папки на Диске нет: ' + path, 409);
      if (!r.ok) throw new DiskError('Не удалось записать на Диск (' + r.status + ')', r.status);
      const { href, method } = await r.json();
      const up = await fetch(href, { method: method || 'PUT', body: new Blob([text], { type: 'application/json' }) });
      if (!up.ok && up.status !== 201 && up.status !== 202) throw new DiskError('Не удалось записать на Диск (' + up.status + ')', up.status);
    }

    /** Файл с компьютера или собранный документ → на Диск. overwrite=false — не затирать существующий. */
    async putBlob(path, blob, overwrite) {
      const r = await this.call('GET', '/resources/upload', { path: diskPath(path), overwrite: overwrite ? 'true' : 'false' });
      if (r.status === 409) throw new DiskError('Файл с таким именем уже есть: ' + path.split('/').pop(), 409);
      if (!r.ok) throw new DiskError('Не удалось записать на Диск (' + r.status + ')', r.status);
      const { href, method } = await r.json();
      const up = await fetch(href, { method: method || 'PUT', body: blob });
      if (!up.ok && up.status !== 201 && up.status !== 202) throw new DiskError('Не удалось записать на Диск (' + up.status + ')', up.status);
    }

    /** Ссылка на скачивание файла (временная). */
    async downloadHref(path) {
      const r = await this.call('GET', '/resources/download', { path: diskPath(path) });
      if (!r.ok) throw new DiskError('Не удалось получить файл (' + r.status + ')', r.status);
      return (await r.json()).href;
    }

    /** В корзину Диска (можно восстановить на disk.yandex.ru). */
    async remove(path) {
      const r = await this.call('DELETE', '/resources', { path: diskPath(path) });
      if (!r.ok && r.status !== 202 && r.status !== 204) throw new DiskError('Не удалось удалить (' + r.status + ')', r.status);
    }

    async move(from, to) {
      const r = await this.call('POST', '/resources/move', { from: diskPath(from), path: diskPath(to) });
      if (r.status === 409) throw new DiskError('Имя уже занято', 409);
      if (!r.ok && r.status !== 201 && r.status !== 202) throw new DiskError('Не удалось переименовать (' + r.status + ')', r.status);
    }

    async mkdir(path) {
      const r = await this.call('PUT', '/resources', { path: diskPath(path) });
      if (!r.ok && r.status !== 409) throw new DiskError('Не удалось создать папку (' + r.status + ')', r.status);
    }
  }

  /** Открыть на сайте Диска: папку — в списке, документ — в Яндекс Документах для правки. */
  const webFolder = (p) => 'https://disk.yandex.ru/client/disk' + normalize(p).split('/').map(encodeURIComponent).join('/');
  const webEdit = (p) => 'https://disk.yandex.ru/edit/disk/' + encodeURIComponent('disk' + normalize(p));

  root.ProrabDisk = { Disk, DiskError, normalize, webFolder, webEdit };
})(window);
