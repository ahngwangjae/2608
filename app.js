const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const STORAGE = { feed: 'campus-flow-feed', done: 'campus-flow-done', cache: 'campus-flow-cache' };
let events = [];
let showAll = { today: false, week: false };

const sampleEvents = () => {
  const now = new Date();
  const at = (days, hour, minute = 0) => { const d = new Date(now); d.setDate(d.getDate() + days); d.setHours(hour, minute, 0, 0); return d; };
  return [
    { id:'demo-1', title:'데이터베이스 과제 2 제출', course:'데이터베이스', due:at(0,23,59), description:'iCampus 과제' },
    { id:'demo-2', title:'Week 4 온라인 강의 수강', course:'경영정보시스템', due:at(0,18), description:'온라인 강의' },
    { id:'demo-3', title:'팀 프로젝트 주제 제안서', course:'소프트웨어공학', due:at(2,23,59), description:'iCampus 과제' },
    { id:'demo-4', title:'알고리즘 퀴즈 응시', course:'알고리즘', due:at(4,20), description:'온라인 퀴즈' },
    { id:'demo-5', title:'읽기 자료 토론 댓글 작성', course:'현대사회와 윤리', due:at(5,23,59), description:'토론' }
  ];
};

function unfoldIcs(text) { return text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/); }
function decodeIcs(value='') { return value.replace(/\\n/gi,' · ').replace(/\\,/g,',').replace(/\\;/g,';').replace(/\\\\/g,'\\').trim(); }
function parseDate(value, params='') {
  if (!value) return null;
  if (/^\d{8}$/.test(value)) return new Date(+value.slice(0,4), +value.slice(4,6)-1, +value.slice(6,8), 23, 59, 59);
  const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
  if (!match) { const d = new Date(value); return isNaN(d) ? null : d; }
  const [,y,m,d,h,min,s='0',z] = match;
  return z ? new Date(Date.UTC(+y,+m-1,+d,+h,+min,+s)) : new Date(+y,+m-1,+d,+h,+min,+s);
}
function normalizeFeedUrl(input='') {
  let value=String(input).trim();
  const markdown=value.match(/^\[[^\]]*\]\((https?:\/\/[^\s)]+|webcal:\/\/[^\s)]+)\)$/i);
  if(markdown) value=markdown[1];
  value=value.replace(/^<|>$/g,'').trim().replace(/^webcal:\/\//i,'https://');
  try {
    const url=new URL(value);
    if(!['http:','https:'].includes(url.protocol)) throw new Error();
    if(!/\.ics(?:$|[?#])/i.test(url.href)) throw new Error('캘린더 피드(.ics) 주소인지 확인해 주세요.');
    return url.href;
  } catch(error) {
    throw new Error(error.message || '올바른 캘린더 피드 주소를 입력해 주세요.');
  }
}
function inferCourse(title, description, categories) {
  const bracket = title.match(/^\[([^\]]+)\]/);
  if (bracket) return bracket[1];
  const labeled = description.match(/(?:과목|강좌|Course)\s*[:：]\s*([^·\n,]+)/i);
  return decodeIcs(labeled?.[1] || categories || '아이캠퍼스');
}
function parseIcs(text) {
  const lines = unfoldIcs(text); const parsed = []; let item = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT' || line === 'BEGIN:VTODO') { item = {}; continue; }
    if (line === 'END:VEVENT' || line === 'END:VTODO') {
      if (item?.title && item?.due && item.status !== 'CANCELLED') parsed.push(item); item = null; continue;
    }
    if (!item) continue;
    const colon = line.indexOf(':'); if (colon < 0) continue;
    const head = line.slice(0,colon), value = line.slice(colon+1); const [key,...paramParts] = head.split(';');
    if (key === 'SUMMARY') item.title = decodeIcs(value);
    if (key === 'DESCRIPTION') item.description = decodeIcs(value);
    if (key === 'CATEGORIES') item.categories = decodeIcs(value);
    if (key === 'UID') item.id = value;
    if (key === 'STATUS') item.status = value;
    if (key === 'URL') item.url = decodeIcs(value);
    if (key === 'DUE' || (key === 'DTSTART' && !item.due)) item.due = parseDate(value, paramParts.join(';'));
    if (key === 'DTEND') {
      item.due = parseDate(value, paramParts.join(';'));
      // iCalendar의 종일 DTEND는 종료일을 포함하지 않으므로 전날 23:59:59가 실제 마감이다.
      if (/VALUE=DATE/i.test(paramParts.join(';')) && item.due) item.due = new Date(item.due.getTime()-1000);
    }
  }
  return parsed.map((e,i) => ({ ...e, id:e.id || `event-${i}-${e.due.getTime()}`, course:inferCourse(e.title,e.description||'',e.categories), title:e.title.replace(/^\[[^\]]+\]\s*/, '') }));
}

function dateKey(date) { return `${date.getFullYear()}-${date.getMonth()+1}-${date.getDate()}`; }
function endOfWeek(date) { const end = new Date(date); const day = end.getDay(); end.setDate(end.getDate() + (day === 0 ? 0 : 7-day)); end.setHours(23,59,59,999); return end; }
function getBuckets() {
  const now = new Date(), todayEnd = new Date(now); todayEnd.setHours(23,59,59,999); const weekEnd = endOfWeek(now);
  const future = events.filter(e => e.due >= new Date(now.getFullYear(),now.getMonth(),now.getDate())).sort((a,b)=>a.due-b.due);
  return { today:future.filter(e=>e.due<=todayEnd), week:future.filter(e=>e.due>todayEnd&&e.due<=weekEnd) };
}
function getDone() { try { return JSON.parse(localStorage.getItem(STORAGE.done)) || []; } catch { return []; } }
function isDone(id) { return getDone().includes(id); }
function toggleDone(id) { const done=getDone(); const next=done.includes(id)?done.filter(x=>x!==id):[...done,id]; localStorage.setItem(STORAGE.done,JSON.stringify(next)); render(); }
function deadlineText(due, type) {
  const now=new Date(); const minutes=Math.max(0,Math.round((due-now)/60000));
  if(type==='today') return minutes<60?`${minutes}분 남음`:`${Math.floor(minutes/60)}시간 남음`;
  return `${due.getMonth()+1}/${due.getDate()} ${['일','월','화','수','목','금','토'][due.getDay()]}요일`;
}
function taskHtml(task,type) {
  const time=task.due.toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'});
  return `<article class="task ${type==='week'?'week-task':''} ${isDone(task.id)?'completed':''}"><button class="check" data-id="${escapeHtml(task.id)}" aria-label="완료 표시">✓</button><div><div class="task-name">${escapeHtml(task.title)}</div><div class="task-meta"><span class="course-tag">${escapeHtml(task.course)}</span><span class="description">${escapeHtml((task.description||'캘린더 일정').slice(0,44))}</span></div></div><div class="deadline"><strong>${deadlineText(task.due,type)}</strong><span>${type==='today'?`오늘 ${time}`:time}</span></div></article>`;
}
function escapeHtml(v='') { const el=document.createElement('div'); el.textContent=v; return el.innerHTML; }
function renderList(element, list, type) {
  const visible=showAll[type]?list:list.slice(0,3); element.innerHTML=visible.length?visible.map(x=>taskHtml(x,type)).join(''):`<div class="empty"><span>✓</span>${type==='today'?'오늘 마감 일정이 없어요':'이번 주 남은 일정이 없어요'}</div>`;
}
function render() {
  const {today,week}=getBuckets(); const done=[...today,...week].filter(x=>isDone(x.id)).length; const total=today.length; const progress=total?Math.round(today.filter(x=>isDone(x.id)).length/total*100):0;
  $('#todayCount').textContent=today.filter(x=>!isDone(x.id)).length; $('#weekCount').textContent=week.filter(x=>!isDone(x.id)).length; $('#doneCount').textContent=done;
  $('#todayBadge').textContent=today.length; $('#weekBadge').textContent=week.length; $('#progressValue').textContent=`${progress}%`; $('#progressRing').style.setProperty('--progress',`${progress*3.6}deg`);
  $('#todayHint').textContent=today.length?`${today.filter(x=>!isDone(x.id)).length}개 남았어요`:'여유로운 하루예요';
  renderList($('#todayList'),today,'today'); renderList($('#weekList'),week,'week');
  $$('.check').forEach(btn=>btn.onclick=()=>toggleDone(btn.dataset.id));
}
function setDate() { const d=new Date(); $('#dateNumber').textContent=d.getDate(); $('#dateMonth').textContent=`${d.getMonth()+1}월`; $('#dateDay').textContent=d.toLocaleDateString('ko-KR',{weekday:'long'}); }
function openModal() { $('#feedModal').classList.add('open'); $('#feedModal').setAttribute('aria-hidden','false'); setTimeout(()=>$('#feedUrl').focus(),100); }
function closeModal() { $('#feedModal').classList.remove('open'); $('#feedModal').setAttribute('aria-hidden','true'); }
function toast(message) { const el=$('#toast'); el.textContent=message; el.classList.add('show'); setTimeout(()=>el.classList.remove('show'),2400); }
function maskedHost(input) { try { const u=new URL(input.replace(/^webcal:/,'https:')); return `${u.hostname} · 연결됨`; } catch { return '피드 연결됨'; } }
async function loadFeed(url, quiet=false) {
  try { url=normalizeFeedUrl(url); }
  catch(error) { $('#formError').textContent=error.message; if(quiet) toast(error.message); return; }
  const button=$('.submit-button'); button.classList.add('loading'); button.disabled=true; $('#formError').textContent=''; $('#refreshButton').classList.add('spinning');
  try {
    const response=await fetch('/api/calendar',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url})});
    if(!response.ok){ const data=await response.json().catch(()=>({})); throw new Error(data.error||'캘린더를 불러오지 못했어요.'); }
    const text=await response.text(); const parsed=parseIcs(text); if(!parsed.length) throw new Error('마감일이 있는 일정을 찾지 못했어요.');
    events=parsed; localStorage.setItem(STORAGE.feed,url); localStorage.setItem(STORAGE.cache,JSON.stringify(parsed)); $('#syncState').textContent=maskedHost(url); render(); closeModal(); toast(`${parsed.length}개의 일정을 불러왔어요.`);
  } catch(error) {
    const message=error instanceof TypeError && /fetch/i.test(error.message)
      ? '앱 서버에 연결할 수 없어요. npm start로 실행한 뒤 http://localhost:4173에서 열어 주세요.'
      : error.message;
    if(quiet) toast(message); else $('#formError').textContent=message;
  }
  finally { button.classList.remove('loading'); button.disabled=false; $('#refreshButton').classList.remove('spinning'); }
}
function restore() {
  const feed=localStorage.getItem(STORAGE.feed), cache=localStorage.getItem(STORAGE.cache);
  if(cache){ try{ events=JSON.parse(cache).map(e=>({...e,due:new Date(e.due)})); render(); }catch{} }
  if(feed){ $('#feedUrl').value=feed; $('#syncState').textContent=maskedHost(feed); loadFeed(feed,true); } else if(!cache) openModal();
}

setDate(); render(); restore();
$('#feedForm').onsubmit=e=>{e.preventDefault();loadFeed($('#feedUrl').value)};
$('#demoButton').onclick=()=>{events=sampleEvents();render();closeModal();toast('예시 일정으로 화면을 채웠어요.')};
[$('#topConnect'),$('#sideConnect'),$('#openSettings')].forEach(b=>b.onclick=openModal);
$('.modal-close').onclick=closeModal; $('#feedModal').onclick=e=>{if(e.target===e.currentTarget)closeModal()};
$('#refreshButton').onclick=()=>{const feed=localStorage.getItem(STORAGE.feed);feed?loadFeed(feed,true):openModal()};
$('.mobile-menu').onclick=()=>$('.sidebar').classList.toggle('open');
$$('[data-toggle]').forEach(btn=>btn.onclick=()=>{const key=btn.dataset.toggle;showAll[key]=!showAll[key];btn.textContent=showAll[key]?'접기':'모두 보기';render()});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal()});
