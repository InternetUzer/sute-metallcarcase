// Export parsing stays on the user's device. Only explicitly selected chats are uploaded.
const MAX_JSON = 100 * 1024 * 1024;
const fail = text => { throw new Error(text); };
const stamp = value => {
 const n = typeof value === 'number' ? value : Date.parse(value) / 1000;
 return Number.isFinite(n) && n > 0 ? n : 0;
};
function partsText(parts) {
 if (typeof parts === 'string') return parts;
 if (!Array.isArray(parts)) return '';
 return parts.map(p => typeof p === 'string' ? p : p && (p.type === 'text' || p.content_type === 'text') ? String(p.text || '') : '[Нетекстовый фрагмент: содержимое не перенесено]').join('\n');
}
export function parseChatExport(raw) {
 const input = Array.isArray(raw) ? raw : Array.isArray(raw?.conversations) ? raw.conversations : raw?.mapping || raw?.chat_messages ? [raw] : null;
 if (!input) fail('Не найден список чатов. Выбери conversations.json из экспорта ChatGPT или Claude.');
 if (input.length > 20000) fail('В файле больше 20 000 чатов. Раздели экспорт.');
 const chats = [], warnings = [];
 for (const [ci,c] of input.entries()) {
  if (!c || typeof c !== 'object') { warnings.push(`Запись ${ci+1}: неизвестный формат`); continue; }
  let source, messages=[], branches=0;
  if (c.mapping && typeof c.mapping === 'object') {
   source='chatgpt'; const nodes=c.mapping, seen=new Set(), chain=[];
   let key=c.current_node;
   if (!key || !nodes[key]) {
    const leaves=Object.keys(nodes).filter(k=>!(nodes[k]?.children?.length));
    if (leaves.length!==1) {warnings.push(`${c.title||'Чат'}: невозможно определить выбранную ветку; чат пропущен`);continue;}
    key=leaves[0];
   }
   while(key && nodes[key]) {
    if(seen.has(key)) fail('В экспорте обнаружена циклическая ветка сообщений.');
    seen.add(key); chain.push([key,nodes[key]]);key=nodes[key].parent;
   }
   if(key) {warnings.push(`${c.title||'Чат'}: неполная цепочка родителей`);}
   branches=Object.keys(nodes).filter(k=>nodes[k]?.message && !seen.has(k)).length;
   for (const [key,node] of chain.reverse()) {
    const m=node.message, role=m?.author?.role;
    if (!m || !['user','assistant'].includes(role) || m.metadata?.is_visually_hidden_from_conversation || (m.recipient && m.recipient!=='all') || (m.channel && m.channel!=='final')) continue;
    let body=partsText(m.content?.parts);
    if(!body && m.content?.text) body=String(m.content.text);
    if(!body && m.content?.content_type && m.content.content_type!=='text') body='[Нетекстовое сообщение: содержимое не перенесено]';
    if(m.metadata?.attachments?.length) body+='\n[Вложения исходного чата не перенесены]';
    if(body.trim()) messages.push({external_id:String(m.id||key),author:role==='user'?'user':'chatgpt',body,at:stamp(m.create_time)});
   }
  } else if(Array.isArray(c.chat_messages)) {
   source='claude';
   for(const [i,m] of c.chat_messages.entries()) {
    if(!m || !['human','assistant','user'].includes(m.sender)) continue;
    let body=partsText(m.content);
    if(!body.trim()) body=String(m.text||'');
    if(m.attachments?.length || m.files?.length) body+='\n[Вложения исходного чата не перенесены]';
    if(body.trim()) messages.push({external_id:String(m.uuid||m.id||i),author:m.sender==='assistant'?'claude':'user',body,at:stamp(m.created_at)});
   }
  } else {warnings.push(`Запись ${ci+1}: неизвестный формат`);continue;}
  if(!messages.length) {warnings.push(`${c.title||c.name||'Чат'}: нет доступных текстовых сообщений`);continue;}
  const title=String(c.title||c.name||'Импортированный диалог').slice(0,240);
  chats.push({source,external_id:String(c.id||c.uuid||c.conversation_id||`${title}:${messages[0].external_id}`),title,messages,branches,created:stamp(c.create_time||c.created_at)});
 }
 return {chats,warnings};
}
export async function loadChatFile(file) {
 if(!file || !file.size) fail('Выбери файл экспорта.');
 if(file.size > 256*1024*1024) fail('Файл больше 256 МБ. Извлеки conversations.json из ZIP и выбери его.');
 let bytes = new Uint8Array(await file.arrayBuffer());
 if(bytes[0]===0x50 && bytes[1]===0x4b) {
  const view=new DataView(bytes.buffer);let end=-1;
  for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--) if(view.getUint32(p,true)===0x06054b50){end=p;break;}
  if(end<0) fail('Повреждён ZIP. Извлеки conversations.json и выбери его напрямую.');
  const entries=view.getUint16(end+10,true);let pos=view.getUint32(end+16,true), found=[];
  if(entries===65535 || pos===0xffffffff) fail('ZIP64 не поддерживается. Извлеки conversations.json.');
  for(let i=0;i<entries;i++) {
   if(pos+46>bytes.length || view.getUint32(pos,true)!==0x02014b50) fail('Повреждён каталог ZIP.');
   const len=view.getUint16(pos+28,true), extra=view.getUint16(pos+30,true), comment=view.getUint16(pos+32,true);
   const name=new TextDecoder().decode(bytes.slice(pos+46,pos+46+len));
   if(/(^|\/)conversations\.json$/i.test(name)) found.push({flags:view.getUint16(pos+8,true),method:view.getUint16(pos+10,true),compressed:view.getUint32(pos+20,true),size:view.getUint32(pos+24,true),offset:view.getUint32(pos+42,true)});
   pos+=46+len+extra+comment;
  }
  if(found.length!==1) fail('В ZIP должен быть один conversations.json. Выбери нужный JSON-файл отдельно.');
  const f=found[0],p=f.offset;
  if(f.flags&1 || f.size>MAX_JSON || p+30>bytes.length || view.getUint32(p,true)!==0x04034b50) fail('Архив зашифрован, повреждён или JSON превышает 100 МБ.');
  const start=p+30+view.getUint16(p+26,true)+view.getUint16(p+28,true);
  if(start+f.compressed>bytes.length) fail('ZIP обрезан.');
  const compressed=bytes.slice(start,start+f.compressed);
  if(f.method===0) bytes=compressed;
  else if(f.method===8) {
   let decoder;try{decoder=new DecompressionStream('deflate-raw')}catch{fail('Этот браузер не распаковывает ZIP. Извлеки conversations.json и выбери его.');}
   const reader=new Blob([compressed]).stream().pipeThrough(decoder).getReader(),chunks=[];let size=0;
   while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_JSON){await reader.cancel();fail('Распакованный JSON больше 100 МБ.');}chunks.push(value);}
   bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  } else fail('Метод сжатия не поддерживается. Выбери распакованный JSON.');
  if(bytes.length!==f.size) fail('Размер распакованного файла не совпал.');
 }
 if(bytes.length>MAX_JSON) fail('JSON больше 100 МБ. Раздели экспорт.');
 let raw;try{raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes).replace(/^\uFEFF/,''));}catch{fail('Не удалось прочитать JSON. Нужен conversations.json из экспорта.');}
 return parseChatExport(raw);
}
