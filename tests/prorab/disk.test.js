const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function client(replies) {
  const calls = [];
  const ctx = { window: {}, URL, URLSearchParams, Blob,
    setTimeout: (f) => { f(); return 1; },
    fetch: async (url, options = {}) => {
      calls.push({ url, options });
      if (!replies.length) throw new Error('Unexpected request');
      const [status, body] = replies.shift();
      return { status, ok: status >= 200 && status < 300, json: async () => body, text: async () => body };
    } };
  vm.runInNewContext(fs.readFileSync('static/prorab/disk.js', 'utf8'), ctx);
  return { disk: new ctx.window.ProrabDisk.Disk('test-token'), calls };
}

test('Disk identity uses immutable uid, transfer URLs never receive OAuth header', async () => {
  const { disk, calls } = client([[200, { user: { uid: '123', display_name: 'Name' } }],
    [200, { href: 'https://downloader.disk.yandex.ru/file' }], [200, 'document']]);
  assert.equal((await disk.user()).uid, '123');
  assert.equal(await disk.getText('/object/file'), 'document');
  assert.equal(calls[1].options.headers.Authorization, 'OAuth test-token');
  assert.equal(calls[2].options.headers, undefined);
  await assert.rejects(client([[200, { user: { display_name: 'Name' } }]]).disk.user(), /идентификатор/);
});

test('asynchronous copy is complete only after operation status success', async () => {
  const { disk, calls } = client([[202, { href: 'https://cloud-api.yandex.net/v1/disk/operations/123' }],
    [200, { status: 'in-progress' }], [200, { status: 'success' }]]);
  await disk.copy('/source', '/target');
  assert.equal(calls.length, 3);
  assert.equal(calls[2].url, 'https://cloud-api.yandex.net/v1/disk/operations/123');
});

test('failed asynchronous operation is not reported as successful', async () => {
  const { disk } = client([[202, { href: 'https://cloud-api.yandex.net/v1/disk/operations/123' }],
    [200, { status: 'failed' }]]);
  await assert.rejects(disk.move('/source', '/target'), /не выполнил/);
});

test('operation polling never sends credentials to an unexpected URL', async () => {
  const { disk, calls } = client([[202, { href: 'https://example.org/steal' }]]);
  await assert.rejects(disk.remove('/object'), /Неожиданный адрес/);
  assert.equal(calls.length, 1);
});
