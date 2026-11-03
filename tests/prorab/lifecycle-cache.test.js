'use strict';
// Отметки удаления неизменяемые: при повторном поиске объектов они не перечитываются по сети.
// Событие, записанное телефоном (LifecycleCore.Event.toJson), принимается кабинетом.
const test = require('node:test');
const assert = require('node:assert');
const L = require('../../static/prorab/project-lifecycle.js');

function disk(files) {
  const reads = [];
  return {
    reads,
    async list(p) {
      const pre = p + '/';
      const out = Object.keys(files).filter((k) => k.startsWith(pre) && !k.slice(pre.length).includes('/'))
        .map((k) => ({ name: k.slice(pre.length), type: 'file', md5: String(files[k].length) + ':' + k }));
      return out.length ? out : null;
    },
    async getText(p) { reads.push(p); return Object.prototype.hasOwnProperty.call(files, p) ? files[p] : null; },
  };
}

const pid = '6f1c0d4e-aaaa-4bbb-8ccc-1234567890ab';
// Строка — ровно как её пишет телефон (порядок полей как у JSON.stringify кабинета)
const phone = '{"format":1,"id":"55555555-5555-4555-8555-555555555555","projectId":"' + pid +
  '","revision":1,"action":"delete","device":"c1f0e2d3-0000-4000-8000-000000000001","at":1793232000500}';

test('cached lifecycle events are not downloaded again', async () => {
  const d = disk({ ['/Диск Прораб+/Склад/' + L.DIR + '/55555555-5555-4555-8555-555555555555.json']: phone });
  const cache = new Map();
  const a = await L.read(d, '/Диск Прораб+/Склад', undefined, cache);
  assert.strictEqual(a.action, 'delete');
  assert.strictEqual(d.reads.length, 1);
  const b = await L.read(d, '/Диск Прораб+/Склад', undefined, cache);
  assert.deepStrictEqual(b, a);
  assert.strictEqual(d.reads.length, 1);
  // Без кэша — как раньше
  await L.read(d, '/Диск Прораб+/Склад');
  assert.strictEqual(d.reads.length, 2);
});

test('event written by the phone is valid for the cabinet', () => {
  assert.doesNotThrow(() => L.validate(JSON.parse(phone), pid));
});
