const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function client(replies, options) {
  const calls = [];
  const ctx = { window: {}, URL, URLSearchParams, Blob, FormData,
    setTimeout: (f) => { f(); return 1; },
    fetch: async (url, options = {}) => {
      calls.push({ url, options });
      if (!replies.length) throw new Error('Unexpected request');
      const reply = replies.shift();
      if (reply instanceof Error) throw reply;
      const [status, body] = reply;
      return { status, ok: status >= 200 && status < 300, json: async () => body, text: async () => body,
        arrayBuffer: async () => Uint8Array.from(body).buffer };
    } };
  vm.runInNewContext(fs.readFileSync('static/prorab/disk.js', 'utf8'), ctx);
  return { disk: new ctx.window.ProrabDisk.Disk('test-token', options), calls };
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

test('phone JSON downloads through same-origin POST without sending OAuth to site', async () => {
  const href = 'https://downloader.disk.yandex.ru/disk/signed-test';
  const { disk, calls } = client([[200, { href }], [200, '{"format":1}']],
    { downloadUrl: '/prorab/download', csrf: 'test-csrf' });
  assert.equal(await disk.getText('/object/data/phone.json'), '{"format":1}');
  assert.equal(calls[0].options.headers.Authorization, 'OAuth test-token');
  assert.equal(calls[1].url, '/prorab/download');
  assert.equal(calls[1].options.method, 'POST');
  assert.equal(calls[1].options.credentials, 'same-origin');
  assert.equal(calls[1].options.headers, undefined);
  assert.deepEqual([...calls[1].options.body.entries()], [['href', href], ['csrf_token', 'test-csrf']]);
  assert.equal(calls.some(c => c.url === href), false);
});

test('download errors explain failure without leaking signed URLs', async () => {
  const href = 'https://downloader.disk.yandex.ru/disk/private-link';
  const options = { downloadUrl: '/prorab/download', csrf: 'test-csrf' };
  await assert.rejects(client([[200, { href }], new TypeError('Failed to fetch ' + href)], options).disk.getText('/object'),
    error => /Нет связи/.test(error.message) && !error.message.includes('private-link'));
  await assert.rejects(client([[200, { href }], [413, { error: 'Файл больше 200 МБ.' }]], options).disk.getText('/object'),
    error => error.status === 413 && /200 МБ/.test(error.message));
});

test('существующая папка не создаётся повторно; файл с тем же именем не считается папкой', async () => {
  const existing = client([[200, { type: 'dir' }]]);
  await existing.disk.mkdir('/Объект/Исполнительная документация');
  assert.equal(existing.calls.length, 1);
  assert.equal(existing.calls[0].options.method, 'GET');
  await assert.rejects(client([[200, { type: 'file' }]]).disk.mkdir('/Документы'), /занят файлом/);
});

test('временный 423 при создании папки повторяется с проверкой существования', async () => {
  const c = client([[404, {}], [423, { error: 'DiskResourceLockedError' }], [404, {}], [201, {}]]);
  await c.disk.mkdir('/Объект/Общий журнал');
  assert.deepEqual(c.calls.map((x) => x.options.method), ['GET', 'PUT', 'GET', 'PUT']);
  const concurrent = client([[404, {}], [423, {}], [200, { type: 'dir' }]]);
  await Promise.all([concurrent.disk.mkdir('/Объект//Общий журнал'), concurrent.disk.mkdir('/Объект/Общий журнал')]);
  assert.equal(concurrent.calls.length, 3);
});

test('409 проверяет папку; отсутствующий родитель не превращается в успешное создание', async () => {
  await client([[404, {}], [409, {}], [200, { type: 'dir' }]]).disk.mkdir('/Объект/Общий журнал');
  await assert.rejects(client([[404, {}], [409, {}], [404, {}]]).disk.mkdir('/Объект/Общий журнал'), /родительская папка/);
});

test('постоянная блокировка ограничена четырьмя попытками; повторное действие после ошибки доступно', async () => {
  const c = client([[423, {}], [423, {}], [423, {}], [423, {}], [200, { type: 'dir' }]]);
  await assert.rejects(c.disk.mkdir('/Объект'), (e) => e.status === 423 && /заблокировал запись/.test(e.message));
  assert.equal(c.calls.length, 4);
  await c.disk.mkdir('/Объект');
  assert.equal(c.calls.length, 5);
});

test('лимит загрузки и отсутствие прав не повторяются, секреты из ответа не выводятся', async () => {
  const quota = client([[404, {}], [423, { error: 'DiskUploadTrafficLimitExceeded', description: 'private-link' }]]);
  await assert.rejects(quota.disk.mkdir('/Объект'), (e) => /лимите загрузки/.test(e.message) && !e.message.includes('private-link'));
  assert.equal(quota.calls.length, 2);
  const denied = client([[403, {}]]);
  await assert.rejects(denied.disk.mkdir('/Объект'), (e) => e.status === 403);
  assert.equal(denied.calls.length, 1);
});

test('асинхронное создание папки дожидается завершения операции', async () => {
  const c = client([[404, {}], [202, { href: 'https://cloud-api.yandex.net/v1/disk/operations/folder' }], [200, { status: 'success' }]]);
  await c.disk.mkdir('/Объект');
  assert.equal(c.calls.length, 3);
});

const uploadHref = 'https://uploader1d.dst.yandex.net:443/upload-target/signed-test';

test('project folder reservation distinguishes new, occupied and missing-parent paths', async () => {
  assert.equal(await client([[201, {}]]).disk.mkdirExclusive('/new'), true);
  for (const type of ['dir', 'file']) assert.equal(await client([[409, {}], [200, { type }]]).disk.mkdirExclusive('/taken'), false);
  await assert.rejects(client([[409, {}], [404, {}]]).disk.mkdirExclusive('/missing/new'), /родительская папка/);
  await assert.rejects(client([[423, {}]]).disk.mkdirExclusive('/new'), e => e.status === 423);
  assert.equal(await client([[202, { href: 'https://cloud-api.yandex.net/v1/disk/operations/new' }], [200, { status: 'success' }]]).disk.mkdirExclusive('/new'), true);
});
const uploadOptions = { uploadUrl: '/prorab/upload', csrf: 'test-csrf' };

test('JSON and Word bytes use same-origin upload without giving the site the OAuth key', async () => {
  for (const isText of [true, false]) {
    const c = client([[200, { href: uploadHref, method: 'PUT' }], [200, { ok: true, upstream_status: 201 }]], uploadOptions);
    if (isText) await c.disk.putText('/object/участники.json', '{"name":"Иван"}');
    else await c.disk.putBlob('/object/журнал.docx', new Blob([new Uint8Array([0x50, 0x4b, 0, 255])]), false);
    assert.equal(c.calls.length, 2);
    assert.equal(c.calls[0].options.headers.Authorization, 'OAuth test-token');
    assert.equal(new URL(c.calls[0].url).searchParams.get('overwrite'), isText ? 'true' : 'false');
    const { url, options } = c.calls[1];
    assert.equal(url, '/prorab/upload');
    assert.equal(options.method, 'POST');
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.headers, undefined);
    assert.equal(options.body.get('href'), uploadHref);
    assert.equal(options.body.get('csrf_token'), 'test-csrf');
    assert.equal(options.body.get('file').name, 'prorab-upload.bin');
    if (isText) assert.equal(await options.body.get('file').text(), '{"name":"Иван"}');
    else assert.deepEqual(new Uint8Array(await options.body.get('file').arrayBuffer()), new Uint8Array([0x50, 0x4b, 0, 255]));
    assert.equal(c.calls.some(x => x.url === uploadHref), false);
  }
});

test('upload 423 is distinguished from a quota and is never blindly retried', async () => {
  for (const quota of [false, true]) {
    const c = client([[200, { href: uploadHref }], [423, { code: quota ? 'UploadTrafficLimitExceeded' : 'DiskResourceLocked' }]], uploadOptions);
    await assert.rejects(c.disk.putText('/object/file', '{}'), e =>
      e.status === 423 && (quota ? /лимите загрузки/.test(e.message) : /заблокировал запись/.test(e.message)));
    assert.equal(c.calls.length, 2);
  }
});

test('upload network failures, expired CSRF and an HTML success page never become saved files', async () => {
  const failures = [
    [new TypeError('Failed to fetch ' + uploadHref), /Сохранение на Диске не подтверждено/],
    [[400, null], /Сессия кабинета истекла/],
    [[200, null], /не подтвердил передачу/],
    [[200, { ok: true, upstream_status: 500 }], /не подтвердил передачу/]
  ];
  for (const [reply, message] of failures) {
    const c = client([[200, { href: uploadHref }], reply], uploadOptions);
    await assert.rejects(c.disk.putBlob('/object/журнал.docx', new Blob(['Word']), false), e =>
      message.test(e.message) && !e.message.includes('signed-test'));
    assert.equal(c.calls.length, 2);
  }
});

test('large files retain direct upload, with no key/cookies/referrer and no raw fetch errors', async () => {
  const blob = new Blob([new Uint8Array(20 * 1024 * 1024 + 1)]);
  const c = client([[200, { href: uploadHref }], [201, {}]], uploadOptions);
  await c.disk.putBlob('/object/drawing.pdf', blob, false);
  assert.equal(c.calls[1].url, uploadHref);
  assert.equal(c.calls[1].options.credentials, 'omit');
  assert.equal(c.calls[1].options.referrerPolicy, 'no-referrer');
  assert.equal(c.calls[1].options.redirect, 'error');
  assert.equal(c.calls[1].options.headers, undefined);
  await assert.rejects(client([[200, { href: uploadHref }], new TypeError('Failed to fetch ' + uploadHref)], uploadOptions)
    .disk.putBlob('/object/drawing.pdf', blob, false), e => /Сохранение не подтверждено/.test(e.message) && !e.message.includes('signed-test'));
});

test('unexpected upload method is rejected before any transfer', async () => {
  const c = client([[200, { href: uploadHref, method: 'DELETE' }]], uploadOptions);
  await assert.rejects(c.disk.putText('/object/участники.json', '{}'), /неподдерживаемый/);
  assert.equal(c.calls.length, 1);
});

test('upload acknowledgement still needs exact document read-back before it is considered saved', async () => {
  const Store = require('../../static/prorab/document-store.js').Store;
  for (const complete of [false, true]) {
    const bytes = new Uint8Array([0x50, 0x4b, 0, 255]);
    const c = client([[200, { href: uploadHref }], [200, { ok: true, upstream_status: 202 }],
      [200, { href: 'https://downloader.disk.yandex.ru/disk/signed-download' }], [200, complete ? bytes : new Uint8Array([0x50])]],
    { ...uploadOptions, downloadUrl: '/prorab/download' });
    const store = new Store(c.disk, '/object/docs');
    let verified = false;
    store.onVerified = async () => { verified = true; };
    if (complete) await store.file('/object/docs/journal.docx', bytes);
    else await assert.rejects(store.file('/object/docs/journal.docx', bytes), /не подтвердил сохранение файла/);
    assert.equal(verified, complete);
    assert.equal(c.calls.length, 4);
    assert.equal(c.calls[1].url, '/prorab/upload');
    assert.equal(c.calls[3].url, '/prorab/download');
  }
});
