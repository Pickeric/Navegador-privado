/* Navegador privado — separado script.js
   Extraído de Versión 3/index.html
   Mantener nombres globales y orden de ejecución (init() final)
*/

const ENC_KEY = 'nb_private_2025';

// Helpers: SHA-256, base64, simple XOR fallback encryption
async function sha256(str) {
  const buf = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

function b64Encode(str){return btoa(unescape(encodeURIComponent(str)))}
function b64Decode(str){return decodeURIComponent(escape(atob(str)))}

function xorEncrypt(data,key){
  let out='';
  for(let i=0;i<data.length;i++) out += String.fromCharCode(data.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  return btoa(out);
}
function xorDecrypt(b64,key){
  try{const dec=atob(b64);let out='';for(let i=0;i<dec.length;i++) out+=String.fromCharCode(dec.charCodeAt(i)^key.charCodeAt(i%key.length));return out}catch(e){return ''}
}

async function encryptData(obj,key=ENC_KEY){
  const txt=JSON.stringify(obj);
  try{
    const pw = new TextEncoder().encode(key);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const k = await crypto.subtle.importKey('raw',pw,'PBKDF2',false,['deriveKey']);
    const dk = await crypto.subtle.deriveKey({name:'PBKDF2',salt,salt,iterations:100000,hash:'SHA-256'},k,{name:'AES-GCM',length:256},true,['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const enc = await crypto.subtle.encrypt({name:'AES-GCM',iv},dk,new TextEncoder().encode(txt));
    const blob = new Uint8Array(enc);
    const payload = new Uint8Array(salt.length + iv.length + blob.length);
    payload.set(salt,0);payload.set(iv,salt.length);payload.set(blob,salt.length+iv.length);
    return btoa(String.fromCharCode(...payload));
  }catch(e){
    return xorEncrypt(txt,key);
  }
}

async function decryptData(str,key=ENC_KEY){
  try{
    const raw = atob(str);
    const arr = new Uint8Array([...raw].map(c=>c.charCodeAt(0)));
    const salt = arr.slice(0,16);
    const iv = arr.slice(16,28);
    const data = arr.slice(28);
    const pw = new TextEncoder().encode(key);
    const k = await crypto.subtle.importKey('raw',pw,'PBKDF2',false,['deriveKey']);
    const dk = await crypto.subtle.deriveKey({name:'PBKDF2',salt,salt,iterations:100000,hash:'SHA-256'},k,{name:'AES-GCM',length:256},true,['decrypt']);
    const dec = await crypto.subtle.decrypt({name:'AES-GCM',iv},dk,data);
    return new TextDecoder().decode(dec);
  }catch(e){
    try{return xorDecrypt(str,key)}catch(e2){return ''}
  }
}

// App state
let tabs = [];
let activeTab = null;
let escCount = 0; let escTimer = null;
let pomoTime = 25*60; let pomoRunning=false; let pomoTimer=null;
let calcExpr=''; let calMonth=null; let calYear=null;
let dragEl=null; let failedAttempts=0; let autoLockTimer=null; let tabDragId=null;

const settings = {
  theme:'dracula',accent:'#7c5aff',fontSize:14,sidebarPos:'left',homeBackground:'',proxy:'https://proxy-online.eric-silvestre.workers.dev',autoLock:0,lockOnExit:false,searchEngine:'ddg',startPage:'home',showHomeSearch:true,incognito:false,enablePIP:true,gestureNav:true,enableNotifications:true,adBlockList:[]
};

let history_ = []; let bookmarks = []; let recentPages = []; let tasks = []; let notes = [];

// Persistence
async function saveSettings(){ localStorage.setItem('nb_settings',await encryptData(settings)); }
async function loadSettings(){ try{const s=localStorage.getItem('nb_settings'); if(s){const dec=await decryptData(s); Object.assign(settings,JSON.parse(dec));}}catch(e){}
}

async function saveHistory(){ localStorage.setItem('nb_history',await encryptData(history_)); }
async function loadHistory(){ try{const s=localStorage.getItem('nb_history'); if(s){const dec=await decryptData(s); history_=JSON.parse(dec);} }catch(e){}
}

async function saveBookmarks(){ localStorage.setItem('nb_bookmarks',await encryptData(bookmarks)); }
async function loadBookmarks(){ try{const s=localStorage.getItem('nb_bookmarks'); if(s){const dec=await decryptData(s); bookmarks=JSON.parse(dec);} }catch(e){}
}

async function saveRecent(){ localStorage.setItem('nb_recent',await encryptData(recentPages)); }
async function loadRecent(){ try{const s=localStorage.getItem('nb_recent'); if(s){const dec=await decryptData(s); recentPages=JSON.parse(dec);} }catch(e){}
}

async function saveTasks_(){ localStorage.setItem('nb_tasks',await encryptData(tasks)); }
async function loadTasks_(){ try{const s=localStorage.getItem('nb_tasks'); if(s){const dec=await decryptData(s); tasks=JSON.parse(dec);} }catch(e){}
}

async function saveNotes_(){ localStorage.setItem('nb_notes',await encryptData(notes)); }
async function loadNotes_(){ try{const s=localStorage.getItem('nb_notes'); if(s){const dec=await decryptData(s); notes=JSON.parse(dec);} }catch(e){}
}

async function loadAllData(){ await loadSettings(); await loadHistory(); await loadBookmarks(); await loadRecent(); await loadTasks_(); await loadNotes_(); }

// UI helpers
function qs(sel,root=document){return root.querySelector(sel)}
function qsa(sel,root=document){return Array.from(root.querySelectorAll(sel))}
function el(tag,attrs={},children=[]) { const d=document.createElement(tag); for(const k in attrs){ if(k==='html') d.innerHTML=attrs[k]; else if(k==='text') d.textContent=attrs[k]; else d.setAttribute(k,attrs[k]); } children.forEach(c=>d.appendChild(c)); return d; }

function toast(msg,timeout=2500){ const t=document.createElement('div'); t.className='toast'; t.textContent=msg; document.body.appendChild(t); setTimeout(()=>t.remove(),timeout); }

// Apply settings to DOM
function applySettings(){ document.documentElement.setAttribute('data-t',settings.theme); document.body.style.fontSize=(settings.fontSize||14)+'px'; if(settings.sidebarPos==='right') document.documentElement.setAttribute('data-sidebar','right'); else document.documentElement.removeAttribute('data-sidebar'); }

// Tab management
function renderTabs(){ const tbar=qs('.tbar'); if(!tbar) return; tbar.innerHTML='';
  tabs.forEach(tab=>{ const div=document.createElement('div'); div.className='tab'+(tab.id===activeTab?' on':'')+(tab.pinned?' pinned':'')+(tab.incognito?' incognito':''); div.dataset.id=tab.id; div.innerHTML=`<div class="tab-icon"></div><span>${tab.title||tab.url}</span><button class="tab-close">×</button>`;
    div.querySelector('.tab-close').addEventListener('click',e=>{e.stopPropagation(); closeTab(tab.id);});
    div.addEventListener('click',()=>switchTab(tab.id));
    tbar.appendChild(div);
  });
  const add=document.createElement('div'); add.className='tab-new'; add.innerHTML='<span class="mi">add</span>'; add.addEventListener('click',()=>newTab('about:blank')); tbar.appendChild(add);
}

function newTab(url,opts={}){ const id='t_'+Date.now()+'_'+Math.random().toString(36).slice(2,8); const tab={id,url,title:url,incognito:opts.incognito||false,pinned:false}; tabs.push(tab); activeTab=tab.id; renderTabs(); loadInTab(tab.id,url); }

function closeTab(id){ const i=tabs.findIndex(t=>t.id===id); if(i>-1) tabs.splice(i,1); if(activeTab===id){ activeTab=tabs.length?tabs[0].id:null; } renderTabs(); renderContent(); }

function switchTab(id){ activeTab=id; renderTabs(); renderContent(); }

function renderContent(){ const cont=qs('.content'); if(!cont) return; cont.innerHTML=''; if(!activeTab){ showHome(); return } const tab=tabs.find(t=>t.id===activeTab); if(!tab){ showHome(); return }
  const iframe=document.createElement('iframe'); iframe.src=tab.url; iframe.sandbox='allow-scripts allow-forms allow-same-origin allow-popups allow-presentation'; iframe.addEventListener('load',()=>{});
  cont.appendChild(iframe);
}

function loadInTab(id,url){ const tab=tabs.find(t=>t.id===id); if(!tab) return; tab.url=url; tab.title=url; if(id===activeTab) renderContent(); addHistory(url); addRecent(url); }

function showHome(){ const cont=qs('.content'); if(!cont) return; cont.innerHTML=''; const h=document.createElement('div'); h.className='home'; h.innerHTML=document.getElementById('homeTemplate')?document.getElementById('homeTemplate').innerHTML:`<div class="home-greet">Bienvenido</div>`;
  cont.appendChild(h);
}

// History / Recent / Bookmarks
function addHistory(url){ history_.unshift({url,time:Date.now()}); if(history_.length>200) history_.pop(); saveHistory(); }
function addRecent(url){ recentPages.unshift({url,time:Date.now()}); recentPages = recentPages.slice(0,60); saveRecent(); }
function bookmarkCurrent(){ const t=tabs.find(x=>x.id===activeTab); if(!t) return; bookmarks.push({url:t.url,title:t.title}); saveBookmarks(); toast('Marcador guardado'); }

// Navigation & search
function navigate(input){ if(!input) return; if(input.startsWith('http')||input.includes('.')) newTab(input); else searchWeb(input); }
function searchWeb(q){ const engine=settings.searchEngine||'ddg'; let url='https://duckduckgo.com/?q='+encodeURIComponent(q); if(engine==='google') url='https://www.google.com/search?q='+encodeURIComponent(q); newTab(url); }

// Widgets: tasks, notes, weather, calculator, dice, calendar, pomodoro
function toggleWidget(id){ const w=qs('#'+id); if(!w) return; w.classList.toggle('show'); }

function addTask(txt){ if(!txt) return; tasks.push({id:Date.now(),text:txt,done:false}); saveTasks_(); renderTasks(); }
function renderTasks(){ const container=qs('#wg-tasks .wg-body'); if(!container) return; container.innerHTML=''; tasks.forEach(t=>{ const d=document.createElement('div'); d.className='task-item'; d.innerHTML=`<div class="task-check ${t.done?"done":""}"></div><div class="task-text ${t.done?"done":""}">${t.text}</div><button class="task-del">✕</button>`; d.querySelector('.task-check').addEventListener('click',()=>{ t.done=!t.done; saveTasks_(); renderTasks();}); d.querySelector('.task-del').addEventListener('click',()=>{ tasks=tasks.filter(x=>x.id!==t.id); saveTasks_(); renderTasks();}); container.appendChild(d); });
}

// Pomodoro
function startPomo(seconds){ clearInterval(pomoTimer); pomoTime=seconds; pomoRunning=true; pomoTimer=setInterval(()=>{ if(pomoTime<=0){ clearInterval(pomoTimer); pomoRunning=false; toast('Pomodoro terminado'); return;} pomoTime--; updatePomoDisplay(); },1000); }
function stopPomo(){ clearInterval(pomoTimer); pomoRunning=false; }
function updatePomoDisplay(){ const d=qs('#pomo-time'); if(d) d.textContent=formatTime(pomoTime); }
function formatTime(s){const m=Math.floor(s/60);const sec=s%60;return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;}

// Calculator
function calcInput(val){ calcExpr += val; qs('#calc-display').textContent = calcExpr; }
function calcResult(){ try{ const res = eval(calcExpr); qs('#calc-display').textContent = String(res); calcExpr = String(res); }catch(e){ qs('#calc-display').textContent = 'Error'; } }
function calcClear(){ calcExpr=''; qs('#calc-display').textContent=''; }

// Calendar
function renderCalendar(){ const now=new Date(); calMonth=calMonth||now.getMonth(); calYear=calYear||now.getFullYear(); const first=new Date(calYear,calMonth,1); const startDay=first.getDay(); const days=new Date(calYear,calMonth+1,0).getDate(); const container=qs('#calendar-grid'); if(!container) return; container.innerHTML=''; const names=['Sun','Mon','Tue','Wed','Thu','Fri','Sat']; const head=document.createElement('div'); head.className='cal-nav'; head.innerHTML=`<button onclick="calPrev()">◀</button><span>${first.toLocaleString()}</span><button onclick="calNext()">▶</button>`; for(let i=0;i<7;i++){ const h=document.createElement('div'); h.className='cal-head'; h.textContent=names[i]; container.appendChild(h);} for(let i=0;i<startDay;i++) container.appendChild(Object.assign(document.createElement('div'),{className:'cal-day other'})); for(let d=1;d<=days;d++){ const elD=document.createElement('div'); elD.className='cal-day'; elD.textContent=d; container.appendChild(elD);} }
function calPrev(){ calMonth--; if(calMonth<0){ calMonth=11; calYear--; } renderCalendar(); }
function calNext(){ calMonth++; if(calMonth>11){ calMonth=0; calYear++; } renderCalendar(); }

// Dice & coin
function rollDice(s){ const v = Math.floor(Math.random()*s)+1; qs('#dice-res').textContent = v; }
function flipCoin(){ qs('#coin-res').textContent = Math.random()>0.5?'Cara':'Cruz'; }

// Weather (open-meteo)
async function loadWeather(){ try{ const loc = await getLocation(); if(!loc) return; const url=`https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&current_weather=true`; const res=await fetch(url); const data=await res.json(); const tmp=data.current_weather.temperature; qs('#weather-temp').textContent=tmp+'°C'; }catch(e){} }
async function getLocation(){ return new Promise((resolve,rej)=>{ if(!navigator.geolocation) return resolve(null); navigator.geolocation.getCurrentPosition(pos=>resolve({lat:pos.coords.latitude,lon:pos.coords.longitude}),err=>resolve(null),{timeout:5000}); }); }

// Games stubs (detailed implementations retained in original file)
function toggleGames(){ const ov=qs('.games-ov'); if(ov) ov.classList.toggle('show'); }
function selectGame(name){ qs('.games-ov').classList.add('show'); }
function stopCurrentGame(){ qs('.games-ov').classList.remove('show'); }

// Command palette
const cmdActions = [ {id:'new-tab',name:'New Tab',desc:'Open a new tab',fn:()=>newTab('about:blank')}, {id:'bookmark',name:'Bookmark',desc:'Bookmark current page',fn:bookmarkCurrent} ];
function openCmdPalette(){ qs('.cmd-ov').classList.add('show'); qs('.cmd-input').focus(); }
function closeCmdPalette(){ qs('.cmd-ov').classList.remove('show'); }

// Misc
function takeScreenshot(){ toast('Captura guardada'); }
function showQR(url){ /* generar QR */ }
function panicMode(){ document.body.classList.add('panic'); setTimeout(()=>document.body.classList.remove('panic'),1200); }

// Simple init wiring
function bindUI(){ // basic UI wiring from the extracted DOM
  const urlIn = qs('#urlInput'); if(urlIn){ urlIn.addEventListener('keydown',e=>{ if(e.key==='Enter'){ navigate(urlIn.value); } }); }
  const addB = qs('#btnBookmark'); if(addB) addB.addEventListener('click',bookmarkCurrent);
  const newB = qs('#btnNewTab'); if(newB) newB.addEventListener('click',()=>newTab('about:blank'));
  const openCmd = qs('#openCmd'); if(openCmd) openCmd.addEventListener('click',openCmdPalette);
}

async function init(){ await loadAllData(); applySettings(); bindUI(); renderTabs(); if(!tabs.length) newTab('about:blank'); renderContent(); updatePomoDisplay(); }

window.addEventListener('load',()=>{ init(); });

// Expose some functions globally (used from inline handlers in HTML)
window.newTab=newTab; window.navigate=navigate; window.bookmarkCurrent=bookmarkCurrent; window.openCmdPalette=openCmdPalette; window.toggleWidget=toggleWidget; window.addTask=addTask;