import assert from 'node:assert/strict';
import {parseChatExport,loadChatFile} from '../static/chat-import.mjs';
const node=(parent,id,role,text)=>({parent,children:[],message:{id,author:{role},content:{parts:[text]},create_time:1700000000}});
const input={id:'a',title:'First <script>',current_node:'final',mapping:{root:{parent:null,children:['u']},u:node('root','u','user','Question'),old:node('u','old','assistant','Discarded answer'),final:node('u','final','assistant','Selected answer')}};
const parsed=parseChatExport([input]);assert.equal(parsed.chats[0].messages.length,2);assert.equal(parsed.chats[0].messages[1].body,'Selected answer');assert.equal(parsed.chats[0].branches,1);
const claude=parseChatExport([{uuid:'c',name:'Claude',chat_messages:[{uuid:'u',sender:'human',text:'Hello',created_at:'2024-01-01T00:00:00Z'},{uuid:'a',sender:'assistant',text:'fallback',content:[{type:'text',text:'Actual answer'}],attachments:[{file_name:'doc.pdf'}]}]}]);
assert.equal(claude.chats[0].messages[0].at,1704067200);assert.match(claude.chats[0].messages[1].body,/Actual answer/);assert.match(claude.chats[0].messages[1].body,/Вложения/);
assert.throws(()=>parseChatExport({wrong:true}));
const circular=structuredClone(input);circular.mapping.u.parent='final';assert.throws(()=>parseChatExport([circular]),/циклическая/);
const file=new Blob([JSON.stringify([input])]);assert.equal((await loadChatFile(file)).chats.length,1);
// ZIP stored entry with a central directory: parser must only read conversations.json.
const content=new TextEncoder().encode(JSON.stringify([input])),name=new TextEncoder().encode('conversations.json');
const data=new Uint8Array(30+name.length+content.length+46+name.length+22),v=new DataView(data.buffer),central=30+name.length+content.length,end=central+46+name.length;
v.setUint32(0,0x04034b50,true);v.setUint32(18,content.length,true);v.setUint32(22,content.length,true);v.setUint16(26,name.length,true);data.set(name,30);data.set(content,30+name.length);
v.setUint32(central,0x02014b50,true);v.setUint32(central+20,content.length,true);v.setUint32(central+24,content.length,true);v.setUint16(central+28,name.length,true);data.set(name,central+46);
v.setUint32(end,0x06054b50,true);v.setUint16(end+10,1,true);v.setUint32(end+16,central,true);
assert.equal((await loadChatFile(new Blob([data]))).chats[0].title,input.title);
console.log('ChatGPT branch, Claude content, dates, attachments, JSON and ZIP parsing: passed');
