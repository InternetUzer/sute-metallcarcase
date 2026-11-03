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
    constructor(token, options) { this.token = token; this.options = options || {}; this.folders = new Map(); }

    async writeError(response, fallback, relay) {
      const body = await response.json().catch(() => ({}));
      const detail = [body && body.error, body && body.code, body && body.reason, body && body.description, body && body.message].join(' ');
      const quota = /UploadTrafficLimitExceeded|UPLOAD_TRAFFIC_LIMIT_EXCEEDED/i.test(detail);
      let message = relay && body && typeof body.error === 'string' ? body.error : fallback + ' (' + response.status + ')';
      if (relay && response.status === 400 && !(body && body.error)) message = 'Сессия кабинета истекла. Сохраните готовый документ на устройство, обновите страницу и повторите.';
      if (relay && response.status === 413) message = 'Сайт не принял файл из-за ограничения размера (413). Скачайте документ на устройство и загрузите через Яндекс Диск.';
      if (response.status === 423) message = quota ?
        'Яндекс Диск сообщил об исчерпанном лимите загрузки (423). Проверьте ограничения в своём аккаунте Диска.' :
        'Яндекс Диск заблокировал запись (423). Повторите позже; если ошибка остаётся, откройте Диск и проверьте его уведомления и ограничения.';
      if (response.status === 507) message = 'На Яндекс Диске недостаточно свободного места (507).';
      const error = new DiskError(message, response.status);
      error.retryable = response.status === 423 && !quota;
      return error;
    }

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
      if (!j.user || !j.user.uid) throw new DiskError('Яндекс Диск не вернул идентификатор аккаунта.', 0);
      return { uid: String(j.user.uid), name: j.user.display_name || j.user.login || '' };
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

    /** Файл целиком (ArrayBuffer) или null, если его нет. */
    async getBytes(path) {
      const r = await this.call('GET', '/resources/download', { path: diskPath(path) });
      if (r.status === 404) return null;
      if (!r.ok) throw new DiskError('Не удалось скачать ' + path.split('/').pop() + ' (' + r.status + ')', r.status);
      const { href } = await r.json();
      const d = await this.download(href);
      if (!d.ok) throw new DiskError('Не удалось скачать ' + path.split('/').pop() + ' (' + d.status + ')', d.status);
      return d.arrayBuffer();
    }

    async getText(path) {
      const r = await this.call('GET', '/resources/download', { path: diskPath(path) });
      if (r.status === 404) return null;
      if (!r.ok) throw new DiskError('Не удалось скачать ' + path + ' (' + r.status + ')', r.status);
      const { href } = await r.json();
      const d = await this.download(href);
      if (!d.ok) throw new DiskError('Не удалось скачать ' + path + ' (' + d.status + ')', d.status);
      return d.text();
    }

    /** Файловый сервер Диска не всегда разрешает CORS. Ключ остаётся в браузере. */
    async download(href) {
      let response;
      try {
        if (this.options.downloadUrl) {
          // Signed link is POST-only: no access-log URL, browser history or referrer.
          response = await fetch(this.options.downloadUrl, { method: 'POST', credentials: 'same-origin',
            body: new URLSearchParams({ href, csrf_token: this.options.csrf || '' }) });
        } else {
          response = await fetch(href, { credentials: 'omit', referrerPolicy: 'no-referrer' });
        }
      } catch (_) {
        throw new DiskError('Нет связи при скачивании файла. Проверьте интернет и повторите.', 0);
      }
      if (!response.ok) {
        const error = this.options.downloadUrl ? await response.json().catch(() => ({})) : {};
        throw new DiskError(error.error || (response.status === 400 ? 'Обновите страницу кабинета и повторите загрузку.' :
          'Не удалось скачать файл (' + response.status + '). Повторите позже.'), response.status);
      }
      return response;
    }

    /** Small files go through the site so the browser can read upload errors as well as success. */
    async upload(href, method, blob) {
      if (method && method !== 'PUT') throw new DiskError('Яндекс Диск вернул неподдерживаемый способ загрузки.', 0);
      const relay = !!this.options.uploadUrl && blob.size <= 20 * 1024 * 1024;
      let response;
      try {
        if (relay) {
          const body = new FormData();
          body.append('href', href);
          body.append('csrf_token', this.options.csrf || '');
          body.append('file', blob, 'prorab-upload.bin');
          response = await fetch(this.options.uploadUrl, { method: 'POST', credentials: 'same-origin', body });
        } else {
          // Large drawings/media retain the existing direct path; never forward the OAuth key.
          response = await fetch(href, { method: 'PUT', body: blob, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error' });
        }
      } catch (_) {
        throw new DiskError(relay ?
          'Связь прервалась при загрузке файла. Сохранение на Диске не подтверждено; повторите после восстановления связи.' :
          'Не удалось передать файл на Яндекс Диск. Сохранение не подтверждено. Проверьте связь и ограничения Диска; большой файл можно загрузить через сайт Диска.', 0);
      }
      if (!response.ok) throw await this.writeError(response, 'Не удалось записать на Диск', relay);
      if (relay) {
        const result = await response.json().catch(() => ({}));
        if (!result || result.ok !== true || ![200, 201, 202, 204].includes(result.upstream_status)) {
          throw new DiskError('Сайт не подтвердил передачу файла на Диск. Скачайте готовый документ на устройство и повторите позже.', 0);
        }
      }
    }

    async putText(path, text) {
      const r = await this.call('GET', '/resources/upload', { path: diskPath(path), overwrite: 'true' });
      if (r.status === 409) throw new DiskError('Папки на Диске нет: ' + path, 409);
      if (!r.ok) throw await this.writeError(r, 'Не удалось записать на Диск');
      const { href, method } = await r.json();
      await this.upload(href, method, new Blob([text], { type: 'application/json' }));
    }

    /** Файл с компьютера или собранный документ → на Диск. overwrite=false — не затирать существующий. */
    async putBlob(path, blob, overwrite) {
      const r = await this.call('GET', '/resources/upload', { path: diskPath(path), overwrite: overwrite ? 'true' : 'false' });
      if (r.status === 409) throw new DiskError('Файл с таким именем уже есть: ' + path.split('/').pop(), 409);
      if (!r.ok) throw await this.writeError(r, 'Не удалось записать на Диск');
      const { href, method } = await r.json();
      await this.upload(href, method, blob);
    }

    /** Ссылка на скачивание файла (временная). */
    async downloadHref(path) {
      const r = await this.call('GET', '/resources/download', { path: diskPath(path) });
      if (!r.ok) throw new DiskError('Не удалось получить файл (' + r.status + ')', r.status);
      return (await r.json()).href;
    }

    /** 202 means queued, not finished. Wait before publishing a reference to the file. */
    async completed(response) {
      if (response.status !== 202) return;
      const link = await response.json();
      let url;
      try { url = new URL(link.href); } catch (_) { throw new DiskError('Нет адреса проверки операции Диска.', 202); }
      if (url.origin !== 'https://cloud-api.yandex.net' || !url.pathname.startsWith('/v1/disk/operations/')) {
        throw new DiskError('Неожиданный адрес операции Диска.', 202);
      }
      for (let attempt = 0; attempt < 60; attempt++) {
        const r = await this.call('GET', url.pathname.slice('/v1/disk'.length));
        if (!r.ok) throw new DiskError('Не удалось проверить операцию Диска (' + r.status + ')', r.status);
        const result = await r.json();
        if (result.status === 'success') return;
        if (result.status !== 'in-progress') throw new DiskError('Яндекс Диск не выполнил операцию.', 0);
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      throw new DiskError('Операция ещё выполняется на Диске. Обновите папку позднее.', 202);
    }

    /** В корзину Диска (можно восстановить на disk.yandex.ru). */
    async remove(path) {
      const r = await this.call('DELETE', '/resources', { path: diskPath(path) });
      if (!r.ok && r.status !== 202 && r.status !== 204) throw new DiskError('Не удалось удалить (' + r.status + ')', r.status);
      await this.completed(r);
    }

    async move(from, to) {
      const r = await this.call('POST', '/resources/move', { from: diskPath(from), path: diskPath(to) });
      if (r.status === 409) throw new DiskError('Имя уже занято', 409);
      if (!r.ok && r.status !== 201 && r.status !== 202) throw new DiskError('Не удалось переименовать (' + r.status + ')', r.status);
      await this.completed(r);
    }

    /** Копия файла на Диске (без скачивания в браузер). */
    async copy(from, to) {
      const r = await this.call('POST', '/resources/copy', { from: diskPath(from), path: diskPath(to), overwrite: 'false' });
      if (r.status === 409) throw new DiskError('Имя уже занято', 409);
      if (!r.ok && r.status !== 201 && r.status !== 202) throw new DiskError('Не удалось скопировать (' + r.status + ')', r.status);
      await this.completed(r);
    }

    async mkdir(path) {
      const key = diskPath(path);
      if (this.folders.has(key)) return this.folders.get(key);
      const work = this.ensureFolder(key);
      this.folders.set(key, work);
      try { return await work; }
      finally { if (this.folders.get(key) === work) this.folders.delete(key); }
    }

    /** Reserve a NEW directory. Unlike mkdir, never reuse another client's project. */
    async mkdirExclusive(path) {
      const key = diskPath(path);
      const r = await this.call('PUT', '/resources', { path: key });
      if (r.ok) { await this.completed(r); return true; }
      if (r.status === 409) {
        const existing = await this.call('GET', '/resources', { path: key, fields: 'type' });
        if (existing.ok && ['dir', 'file'].includes((await existing.json()).type)) return false;
        if (existing.status === 404) throw new DiskError('Не удалось создать объект: родительская папка отсутствует. Обновите рабочий стол.', 409);
        throw await this.writeError(existing, 'Не удалось проверить имя объекта');
      }
      throw await this.writeError(r, 'Не удалось создать объект');
    }

    /** An existing directory needs no PUT; 409 alone does not prove it exists. */
    async ensureFolder(path) {
      const directory = async (response) => {
        const value = await response.json();
        if (value && value.type === 'dir') return;
        throw new DiskError('Путь для папки занят файлом или не распознан: ' + path.replace(/^disk:/, ''), 409);
      };
      for (let attempt = 0; attempt < 4; attempt++) {
        let r = await this.call('GET', '/resources', { path, fields: 'type' });
        if (r.ok) return directory(r);
        if (r.status === 404) {
          r = await this.call('PUT', '/resources', { path });
          if (r.ok) { await this.completed(r); return; }
          if (r.status === 409) {
            // Another client may have created it; a missing parent also returns 409.
            r = await this.call('GET', '/resources', { path, fields: 'type' });
            if (r.ok) return directory(r);
            if (r.status === 404) throw new DiskError('Не удалось создать папку: родительская папка отсутствует или путь изменён. Обновите объект.', 409);
          }
        }
        const error = await this.writeError(r, 'Не удалось создать папку');
        if (!error.retryable || attempt === 3) throw error;
        await new Promise((resolve) => setTimeout(resolve, 750 * Math.pow(2, attempt)));
      }
    }
  }

  /** Открыть на сайте Диска: папку — в списке, документ — в Яндекс Документах для правки. */
  const webFolder = (p) => 'https://disk.yandex.ru/client/disk' + normalize(p).split('/').map(encodeURIComponent).join('/');
  const webEdit = (p) => 'https://disk.yandex.ru/edit/disk/' + encodeURIComponent('disk' + normalize(p));
  /** Файл в просмотрщике Яндекс Диска (фото листаются, видео играет): папка файла + окно просмотра. */
  const webView = (p) => {
    const full = normalize(p);
    return webFolder(full.slice(0, full.lastIndexOf('/')) || '/') + '?idApp=client&dialog=slider&idDialog=' + encodeURIComponent('/disk' + full);
  };

  root.ProrabDisk = { Disk, DiskError, normalize, webFolder, webEdit, webView };
})(window);
