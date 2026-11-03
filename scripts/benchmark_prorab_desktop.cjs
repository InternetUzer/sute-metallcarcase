const crypto=require('crypto');const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert/strict');
// Optional development benchmark: npm package playwright + Chromium; no production dependency.
// PRORAB_BENCH_BASE=180efb3 compares that commit's app.js with the current supporting modules.
const {chromium}=require('playwright');const root=process.cwd(),out=fs.mkdtempSync(path.join(require('os').tmpdir(),'prorab-desktop-bench-'));
const baseline=process.env.PRORAB_BENCH_BASE?require('child_process').execFileSync('git',['show',process.env.PRORAB_BENCH_BASE+':static/prorab/app.js']):null;
const scripts=[...fs.readFileSync('templates/prorab.html','utf8').matchAll(/<script src="([^?]+)\?[^\"]+"><\/script>/g)].map(x=>x[1]);
const html='<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/static/prorab/prorab.css"><body class="pp-body"><div id="prorab" class="pp-app" data-store="qa-projects" data-version="24" data-root="/Диск Прораб+" data-root-save="/admin/prorab/root"></div>'+scripts.map(s=>'<script src="'+s+'"></script>').join('')+'</body></html>';
const dirs=new Set(['/','/Диск Прораб+']),files=new Map(),trash=new Map(),requests=[];let failWrite=false,failList=null;
const children=p=>{const items=new Map();for(const f of [...dirs,...files.keys()])if(f.startsWith(p+'/')){const rel=f.slice(p.length+1),name=rel.split('/')[0];items.set(name,{name,type:rel.includes('/')||dirs.has(f)?'dir':'file',modified:'2026-10-29T00:00:00Z',md5:files.has(f)?crypto.createHash('md5').update(files.get(f)).digest('hex'):undefined})}return [...items.values()]};
const oldEconomy='/Прораб+ Экономика/economy.prorab.json';files.set(oldEconomy,Buffer.from('OLD ECONOMY MUST STAY UNTOUCHED'));dirs.add('/Прораб+ Экономика');
const cors={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,PUT,POST,OPTIONS,DELETE'};
const reply=(route,status,body)=>route.fulfill({status,headers:cors,contentType:'application/json',body:JSON.stringify(body)});
const server=http.createServer((req,res)=>{const url=decodeURIComponent(req.url.split('?')[0]);if(url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(html)}const p=path.join(root,url);if(!p.startsWith(root+path.sep)||!fs.existsSync(p)){res.statusCode=404;return res.end('missing')}res.setHeader('Content-Type',url.endsWith('.js')?'text/javascript':url.endsWith('.css')?'text/css':'application/octet-stream');baseline&&url==='/static/prorab/app.js'?res.end(baseline):fs.createReadStream(p).pipe(res)});
async function install(context){await context.addInitScript(()=>localStorage.setItem('prorab.qa-projects.token','test-fixture-not-a-secret'));
await context.route('https://cloud-api.yandex.net/**',async route=>{
 const req=route.request(),u=new URL(req.url()),method=req.method(),p=(u.searchParams.get('path')||'').replace(/^disk:/,'');
 requests.push({method,path:p,api:u.pathname});
 if(method==='DELETE'&&u.pathname.endsWith('/resources')){if(!dirs.has(p)&&!files.has(p))return reply(route,404,{});const df=[...dirs].filter(x=>x===p||x.startsWith(p+'/')),ff=[...files].filter(([x])=>x===p||x.startsWith(p+'/'));trash.set(p,{dirs:df,files:ff});df.forEach(x=>dirs.delete(x));ff.forEach(([x])=>files.delete(x));return route.fulfill({status:204,headers:cors});}
 if(method==='OPTIONS')return route.fulfill({status:204,headers:cors});
 await new Promise(r=>setTimeout(r,300));
 if(u.pathname==='/v1/disk')return reply(route,200,{user:{uid:'test-account',display_name:'QA'}});
 if(u.pathname.endsWith('/download')){if(!files.has(p))return reply(route,404,{});return reply(route,200,{href:'https://disk-fixture.test/read?path='+encodeURIComponent(p)})}
 if(u.pathname.endsWith('/upload')){if(failWrite)return reply(route,423,{error:'Locked'});if(files.has(p)&&u.searchParams.get('overwrite')!=='true')return reply(route,409,{});return reply(route,200,{href:'https://disk-fixture.test/write?path='+encodeURIComponent(p),method:'PUT'})}
 if(u.pathname.endsWith('/resources')&&method==='PUT'){if(dirs.has(p)||files.has(p))return reply(route,409,{});if(failWrite)return reply(route,423,{});dirs.add(p);return reply(route,201,{})}
 if(u.pathname.endsWith('/resources')&&method==='GET'){
  if(failList===p)return reply(route,503,{});
  if(!dirs.has(p)&&!files.has(p))return reply(route,404,{});
  if(u.searchParams.get('fields')==='type')return reply(route,200,{type:dirs.has(p)?'dir':'file'});
  const items=children(p);return reply(route,200,{_embedded:{items,total:items.length}});
 }
 console.error('Unhandled API',method,u.pathname,p);return reply(route,500,{});
});
await context.route('https://disk-fixture.test/**',async route=>{const u=new URL(route.request().url()),p=u.searchParams.get('path');if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:cors});await new Promise(r=>setTimeout(r,300));if(u.pathname==='/write'){files.set(p,route.request().postDataBuffer());return route.fulfill({status:201,headers:cors})}return route.fulfill({status:200,headers:cors,body:files.get(p)})});}
const closeWins=async p=>{while(await p.locator('.pp-winbtns button[title="Закрыть"]').count())await p.locator('.pp-winbtns button[title="Закрыть"]').last().click()};
const create=async(p,name)=>{await p.locator('.pp-icons button[title="Создать объект"]').click();await p.getByLabel('Название объекта',{exact:true}).fill(name);await p.locator('.pp-modal').getByRole('button',{name:'Создать',exact:true}).click();await p.getByRole('heading',{name:'Новый объект — карточка',exact:true}).waitFor();};

const vm=require('vm'),W={window:{}};vm.runInNewContext(fs.readFileSync('static/prorab/schema.js','utf8'),W);
const C=require(path.join(root,'static/prorab/project-create.js')),S=require(path.join(root,'static/prorab/sync.js'));
for(let i=1;i<=20;i++){const name='Объект '+String(i).padStart(2,'0'),task=C.prepare('/Диск Прораб+',name,'phone-'+i,W.window.PRORAB_SCHEMA,new S.Clock(),['м']);
const dir='/Диск Прораб+/'+name;dirs.add(dir);dirs.add(dir+'/data');dirs.add(dir+'/files');for(let j=1;j<=4;j++)files.set(dir+'/data/phone-'+j+'.json',Buffer.from(task.text));}
files.set('/Диск Прораб+/Начальный ярлык.url',Buffer.from('[InternetShortcut]\r\nURL=https://example.com\r\n'));
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({executablePath:process.env.PRORAB_CHROMIUM||undefined,headless:true,args:['--no-sandbox','--disable-gpu']});const context=await browser.newContext({viewport:{width:1440,height:1000}});await install(context);const p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.type()==='prompt'?d.accept(d.message().includes('Адрес')?'https://example.com':'Тест скорости'):d.accept());
const url='http://127.0.0.1:'+server.address().port+'/'; const results={mode:baseline?'before':'after',objects:20,responseDelayMs:300};
try{
 let t=Date.now();await p.goto(url);await p.locator('.pp-icons button[title="Объект 01"]').waitFor();results.firstObjectMs=Date.now()-t;
 await p.locator('.pp-icons button[title="Начальный ярлык"]').waitFor();results.fullDesktopMs=Date.now()-t;await new Promise(r=>setTimeout(r,800));
 requests.length=0;await p.locator('.pp-icons').dispatchEvent('contextmenu',{bubbles:true,clientX:600,clientY:500});t=Date.now();await p.locator('.pp-menu').getByRole('button',{name:'🔗 Ярлык на сайт',exact:true}).click();await p.locator('.pp-icons button[title="Тест скорости"]').waitFor();results.createShortcutMs=Date.now()-t;
 await new Promise(r=>setTimeout(r,500));results.createShortcutFolderReads=requests.filter(r=>r.method==='GET'&&r.api.endsWith('/resources')&&r.path.startsWith('/Диск Прораб+/Объект')).length;
 t=Date.now();await p.reload();await p.locator('.pp-icons button[title="Тест скорости"]').waitFor();results.warmFilesMs=Date.now()-t;await new Promise(r=>setTimeout(r,2200));
 t=Date.now();await p.locator('.pp-icons button[title="Объект 01"]').dblclick();await p.getByRole('button',{name:'🪪 Карточка объекта',exact:true}).waitFor();results.openFourDeviceObjectMs=Date.now()-t;
 requests.length=0;await p.getByRole('button',{name:'⟳ Обновить',exact:true}).click();await new Promise(r=>setTimeout(r,3800));results.unchangedObjectDownloads=requests.filter(r=>r.api.endsWith('/download')&&r.path.includes('/data/')).length;
 await closeWins(p);requests.length=0;await p.locator('.pp-tray[title="Обновить"]').click();await p.locator('.pp-tray[title="Обновить"]').click();await new Promise(r=>setTimeout(r,2600));results.doubleRefreshRootReads=requests.filter(r=>r.method==='GET'&&r.api.endsWith('/resources')&&r.path==='/Диск Прораб+').length;
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'performance-'+results.mode+'.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results));
}catch(e){console.error(e);console.error(await p.locator('body').innerText());process.exitCode=1;}finally{await browser.close();server.close()}
})();
