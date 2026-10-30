/* Local, account-scoped diagnostics. Never store request bodies, credentials or signed URLs. */
(function (root) {
  'use strict';
  function clean(value, secrets) {
    let s = String(value == null ? '' : value);
    for (const secret of secrets || []) if (secret && secret.length >= 4) s = s.split(secret).join('[скрыто]');
    return s.replace(/https?:\/\/[^\s<>"']+/gi, (u) => { try { const url = new URL(u); return url.origin + url.pathname; } catch (_) { return '[адрес скрыт]'; } })
      .replace(/\b(?:OAuth|Bearer)\s+[^\s,;]+/gi, '[ключ скрыт]')
      .replace(/((?:access[_-]?token|refresh[_-]?token|password|secret|authorization|пароль)["']?\s*[=:]\s*["']?)[^\s,;"']+/gi, '$1[скрыто]')
      .replace(/[A-Za-z0-9_+\/-]{32,}={0,2}/g, '[идентификатор скрыт]').slice(0, 1000);
  }
  class Log {
    constructor(storage, secrets) {
      this.storage = storage; this.secrets = secrets || []; this.key = 'diagnostics.v1'; this.persistent = true;
      const rows = storage.json(this.key, []); this.entries = Array.isArray(rows) ? rows.slice(-500) : [];
    }
    rows() {
      return this.entries.filter((x) => x && typeof x.at === 'number').map((x) => this.safe(x));
    }
    safe(e) {
      const out = { at: e.at, level: ['error', 'warning'].includes(e.level) ? e.level : 'info' };
      for (const k of ['operation', 'project', 'message']) out[k] = clean(e[k], this.secrets);
      if (Number.isInteger(e.status) && e.status >= 0 && e.status < 600) out.status = e.status;
      return out;
    }
    add(level, operation, message, project, status) {
      const rows = this.rows(), next = this.safe({ at: Date.now(), level, operation, message, project, status });
      rows.push(next); this.entries = rows.slice(-500); this.persistent = this.storage.set(this.key, JSON.stringify(this.entries)) !== false; return next;
    }
    clear() { this.entries = []; this.persistent = this.storage.set(this.key, '[]') !== false; }
    export() { return JSON.stringify({ format: 1, source: 'prorab-web', scope: 'this-browser', exportedAt: new Date().toISOString(), entries: this.rows() }, null, 2); }
    watch(disk) {
      for (const name of ['list', 'getBytes', 'putBlob', 'putText', 'mkdir', 'mkdirExclusive', 'remove', 'move', 'copy']) {
        if (typeof disk[name] !== 'function') continue;
        const original = disk[name].bind(disk);
        disk[name] = async (...args) => {
          try { return await original(...args); }
          catch (e) { try { this.add('error', 'Диск: ' + name, e.message, args[0], e.status); } catch (_) { /* retain original error */ } throw e; }
        };
      }
      return disk;
    }
  }
  const api = { clean, Log };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ProrabDiagnostics = api;
})(typeof window !== 'undefined' ? window : globalThis);
