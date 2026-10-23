const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../../static/prorab/gallery.js');
const project = (tables) => ({ projectId: 'p', rows: (t) => tables[t] || [] });
const att = (id, ownerId, extra = {}) => ({ id, ownerId, projectId: 'p', file: id + '.jpg', kind: 'photo', ...extra });

test('work and remark captions include their own dates and before/after stage', () => {
  const p = project({ volumes: [{ id: 'v', projectId: 'p', name: 'Бетон Ф1', date: 100 }], remarks: [{ id: 'r', projectId: 'p', number: 7, text: 'Шов', date: 101, doneDate: 102 }], attachments: [att('a', 'v'), att('b', 'r'), att('c', 'r:done', { kind: 'video' })] });
  const entries = G.collect(p);
  assert.deepEqual(entries.map((e) => e.date), [102, 101, 100]);
  assert.match(entries[0].caption, /Замечание №7.*После устранения/);
  assert.equal(entries[0].video, true);
  assert.match(entries[1].caption, /До устранения/);
  assert.match(entries[2].caption, /Бетон Ф1/);
});

test('deleted records, deleted attachments and other objects are excluded', () => {
  const p = project({ remarks: [{ id: 'r', projectId: 'p', deleted: 1 }], attachments: [att('a', 'r'), att('b', 'r:done'), att('c', 'unknown'), att('d', 'unknown', { deleted: 1 }), att('e', 'unknown', { projectId: 'other' })] });
  assert.equal(G.collect(p).length, 1);
  assert.equal(G.collect(p)[0].caption, 'Источник записи недоступен');
});

test('receipt appears once but shared file with different sources keeps both captions', () => {
  const f = { id: 'f', projectId: 'p', title: 'Бетон', photo: 'receipt.jpg', date: 100 };
  assert.equal(G.collect(project({ finance: [f] }))[0].caption, 'Чек · Бетон');
  const a = att('a', 'f', { file: f.photo });
  assert.equal(G.collect(project({ finance: [f], attachments: [a] })).length, 1);
  assert.equal(G.collect(project({ finance: [f], attachments: [a, { ...a, id: 'b', ownerId: 'v' }] })).length, 2);
});

test('extra work, approval, drawing and acceptance captions are distinct', () => {
  const entries = G.collect(project({
    extra_approvals: [{ id: 'extra:i', projectId: 'p', description: 'Проём' }],
    drawing_notes: [{ id: 'n', projectId: 'p', drawingId: 'd', number: 3, text: 'Шов' }],
    drawings: [{ id: 'd', projectId: 'p', name: 'КМ-1' }],
    acceptances: [{ id: 'ac', projectId: 'p', workName: 'Монтаж', readyDate: 50 }],
    attachments: [att('a','extra:i'),att('b','extra:i:work'),att('c','n:done'),att('d','ac')],
  }));
  assert.ok(entries.some((e) => e.caption.includes('Проём · Подтверждение')));
  assert.ok(entries.some((e) => e.caption.includes('Проём · Фото работы')));
  assert.ok(entries.some((e) => e.caption.includes('КМ-1') && e.caption.endsWith('После устранения')));
  assert.ok(entries.some((e) => e.caption === 'Приёмка · Монтаж'));
});

test('collect does not change source data', () => {
  const tables = { attachments: [att('a', 'missing')] };
  const before = JSON.stringify(tables); G.collect(project(tables));
  assert.equal(JSON.stringify(tables), before);
});

test('video upload keeps a video format and bypasses image encoding', () => {
  assert.deepEqual(G.uploadKind({ name: 'clip.MOV', type: 'video/quicktime' }), { video: true, extension: 'mov' });
  assert.deepEqual(G.uploadKind({ name: 'clip', type: 'video/mp4' }), { video: true, extension: 'mp4' });
  assert.deepEqual(G.uploadKind({ name: 'photo.png', type: 'image/png' }), { video: false, extension: 'jpg' });
  assert.throws(() => G.uploadKind({ name: 'x.html', type: 'text/html' }), /фото или видео/);
});

test('record upload sends original video bytes and commits a video attachment', async () => {
  const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '../../static/prorab/app.js'), 'utf8');
  const from = source.indexOf('  function photoBox('), to = source.indexOf('  // ───────── отчёты', from);
  const elements = [], uploads = [], attachments = [];
  const h = (tag, attrs, ...children) => {
    const e = { tag, attrs, children, events: {}, append(...x) { this.children.push(...x); }, addEventListener(k,f) { this.events[k] = f; }, remove() {} };
    elements.push(e); return e;
  };
  const context = { window: { ProrabGallery: G }, h, button: (t,f) => h('button',{onclick:f},t), S: {newId:()=> 'file-id'}, hrefCache: {},
    disk: { mkdir: async()=>{}, putBlob: async(...args)=> uploads.push(args) },
    shrink: ()=> { throw Error('Video must not be JPEG encoded'); }, alert: (message)=> { throw Error(message); }, D: {},
  };
  vm.createContext(context); vm.runInContext(source.slice(from,to) + '\nthis.makePhotoBox = photoBox;', context);
  const box = context.makePhotoBox({path:'/object',project:{ attachmentsOf:()=>[], addAttachment:(...a)=>attachments.push(a),removeAttachment:()=>{} }},'owner','Фото и видео');
  const input = elements.find((e)=>e.tag==='input' && e.attrs.type==='file');
  assert.equal(input.attrs.accept,'image/*,video/*');
  const video = { name:'site.MOV', type:'video/quicktime', bytes:'original' };
  input.files = [video]; await input.events.change();
  assert.equal(uploads.length,1);
  assert.equal(uploads[0][0],'/object/files/file-id.mov');
  assert.equal(uploads[0][1],video);
  assert.equal(box.busy(),false);
  assert.equal(attachments.length,0);
  box.commit('owner');
  assert.deepEqual(attachments,[['owner','file-id.mov','video']]);
});
