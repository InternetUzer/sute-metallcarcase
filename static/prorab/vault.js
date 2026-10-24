/*
 * «Прораб+» — зашифрованная экономика собственника (сумма договора, бюджет, маржа, поступления).
 * Данные шифруются в браузере (AES-256-GCM) случайным ключом данных. Этот ключ хранится в файле дважды:
 * зашифрованным ключом из кода собственника и ключом из кода восстановления (PBKDF2-SHA-256).
 * Код никуда не отправляется; на Диске и на сервере сайта — только шифр. Без кода и кода восстановления
 * данные не прочитать никому, в том числе нам.
 * Без DOM — проверяется тестами в Node (crypto.subtle).
 */
(function (root) {
  'use strict';
  const subtle = (root.crypto || globalThis.crypto).subtle;
  const enc = new TextEncoder(), dec = new TextDecoder();
  const FORMAT = 'prorab-economy';
  const AAD = enc.encode('prorab-economy-v1');
  const ITERATIONS = 600000;
  const MIN_CODE = 8;
  // Код восстановления: без похожих букв и цифр (0/O, 1/I/L)
  const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

  const random = (n) => (root.crypto || globalThis.crypto).getRandomValues(new Uint8Array(n));
  function b64(bytes) { let s = ''; bytes.forEach((b) => { s += String.fromCharCode(b); }); return btoa(s); }
  function unb64(s) { const bin = atob(s); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; }

  class VaultError extends Error {}

  function newRecoveryCode() {
    const bytes = random(24);
    let s = '';
    for (let i = 0; i < 24; i++) { s += ALPHABET[bytes[i] % ALPHABET.length]; if (i % 4 === 3 && i < 23) s += '-'; }
    return s;
  }
  const normRecovery = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

  async function deriveKey(secret, salt, iterations) {
    const base = await subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveKey']);
    return subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function wrap(raw, secret, iterations) {
    const salt = random(16), iv = random(12);
    const k = await deriveKey(secret, salt, iterations);
    return { salt: b64(salt), iv: b64(iv), key: b64(new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, k, raw))) };
  }
  async function unwrap(slot, secret, iterations) {
    const k = await deriveKey(secret, unb64(slot.salt), iterations);
    return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: unb64(slot.iv) }, k, unb64(slot.key)));
  }
  const dataKey = (raw) => subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);

  function checkCode(code) {
    if (String(code || '').length < MIN_CODE) throw new VaultError('Код — не короче ' + MIN_CODE + ' знаков.');
  }

  /** Новое хранилище: { vault, recovery } — код восстановления показать один раз. */
  async function create(code, opts) {
    checkCode(code);
    const iterations = (opts && opts.iterations) || ITERATIONS;
    const raw = random(32), recovery = newRecoveryCode();
    const header = {
      format: FORMAT, version: 1, kdf: { name: 'PBKDF2-SHA-256', iterations },
      slots: { code: await wrap(raw, code, iterations), recovery: await wrap(raw, normRecovery(recovery), iterations) },
    };
    return { vault: { header, raw, key: await dataKey(raw) }, recovery };
  }

  function validHeader(file) {
    return file && file.format === FORMAT && file.version === 1 && file.kdf && file.slots && file.slots.code && file.slots.recovery;
  }

  /** Открыть кодом (или кодом восстановления, byRecovery = true). Неверный код — VaultError. */
  async function unlock(file, secret, byRecovery) {
    if (!validHeader(file)) throw new VaultError('Файл экономики повреждён или из другой программы.');
    const slot = byRecovery ? file.slots.recovery : file.slots.code;
    let raw;
    try { raw = await unwrap(slot, byRecovery ? normRecovery(secret) : String(secret || ''), file.kdf.iterations); }
    catch (e) { throw new VaultError(byRecovery ? 'Код восстановления не подходит.' : 'Неверный код.'); }
    const header = { format: file.format, version: file.version, kdf: file.kdf, slots: file.slots };
    return { header, raw, key: await dataKey(raw) };
  }

  /** Сменить код (данные не перешифровываются; код восстановления остаётся прежним). */
  async function changeCode(vault, code) {
    checkCode(code);
    vault.header = Object.assign({}, vault.header, { slots: Object.assign({}, vault.header.slots, { code: await wrap(vault.raw, code, vault.header.kdf.iterations) }) });
    return vault;
  }

  /** Новый код восстановления (старый перестаёт действовать). */
  async function newRecovery(vault) {
    const recovery = newRecoveryCode();
    vault.header = Object.assign({}, vault.header, { slots: Object.assign({}, vault.header.slots, { recovery: await wrap(vault.raw, normRecovery(recovery), vault.header.kdf.iterations) }) });
    return recovery;
  }

  /** Данные → файл для Диска (заголовок + шифр). */
  async function seal(vault, data, rev) {
    const iv = random(12);
    const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: AAD }, vault.key, enc.encode(JSON.stringify(data))));
    return Object.assign({}, vault.header, { rev: rev || 1, savedAt: Date.now(), payload: { iv: b64(iv), data: b64(ct) } });
  }

  /** Файл → данные (null, если данных ещё нет). Подмена шифра — VaultError. */
  async function open(vault, file) {
    if (!file.payload) return null;
    try {
      const pt = await subtle.decrypt({ name: 'AES-GCM', iv: unb64(file.payload.iv), additionalData: AAD }, vault.key, unb64(file.payload.data));
      return JSON.parse(dec.decode(pt));
    } catch (e) { throw new VaultError('Данные экономики повреждены или изменены без кода.'); }
  }

  const api = { create, unlock, changeCode, newRecovery, seal, open, validHeader, VaultError, MIN_CODE, normRecovery };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ProrabVault = api;
})(typeof window !== 'undefined' ? window : globalThis);
