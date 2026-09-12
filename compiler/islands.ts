/**
 * Deshi island hydration — one static runtime: /_deshi/islands.js
 *
 * SSG emits <deshi-island data-strategy data-component data-src>. This file
 * imports data-src only when that island's strategy fires.
 *
 *   load    — import immediately (and modulepreload from SSR)
 *   visible — IntersectionObserver on the inner [data-deshi-c] box
 *   idle    — visible, then requestIdleCallback (no Counter.js on first paint)
 *   click   — first click
 *
 * Click on an unhydrated island is queued and replayed after mount.
 */
export const ISLANDS_RUNTIME = `const MOUNTED='data-deshi-hydrated';
let cleanups=[];
const queued=[];
let replaying=false;
function ensureCss(){
  if(document.getElementById('deshi-island-css'))return;
  const s=document.createElement('style');
  s.id='deshi-island-css';
  s.textContent='deshi-island{display:block}';
  (document.head||document.documentElement).appendChild(s);
}
function box(island){
  return island.querySelector('[data-deshi-c]')||island.firstElementChild||island;
}
function inViewport(el){
  const r=el.getBoundingClientRect();
  const vh=window.innerHeight||document.documentElement.clientHeight||0;
  const vw=window.innerWidth||document.documentElement.clientWidth||0;
  return r.width>0&&r.height>0&&r.bottom>0&&r.right>0&&r.top<vh&&r.left<vw;
}
function cleanup(){
  for(let i=0;i<cleanups.length;i++){try{cleanups[i]()}catch(e){}}
  cleanups=[];
}
function mount(island){
  if(island.getAttribute(MOUNTED)==='1'||island.getAttribute(MOUNTED)==='pending')return island._deshiMount||Promise.resolve();
  const inner=island.querySelector('[data-deshi-c]');
  if(!inner)return Promise.resolve();
  const src=island.getAttribute('data-src')||('/_deshi/c/'+(island.getAttribute('data-component')||'')+'.'+(inner.getAttribute('data-deshi-c')||'')+'.js');
  island.setAttribute(MOUNTED,'pending');
  const props=(()=>{try{return JSON.parse(inner.getAttribute('data-deshi-props')||'{}')}catch(e){return{}}})();
  island._deshiMount=import(/* @vite-ignore */ src).then(function(m){
    const fn=m&&m.default;
    if(typeof fn==='function')fn(inner,{props:props,url:location.href});
    island.setAttribute(MOUNTED,'1');
    replay(island);
  }).catch(function(err){
    island.removeAttribute(MOUNTED);
    island._deshiMount=null;
    console.error('[deshi] island failed',src,err);
  });
  return island._deshiMount;
}
function replay(island){
  const rest=[];
  replaying=true;
  try{
    for(let i=0;i<queued.length;i++){
      const q=queued[i];
      if(q.island!==island){rest.push(q);continue}
      if(q.el&&q.el.isConnected)q.el.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window}));
    }
  }finally{replaying=false}
  queued.length=0;
  for(let i=0;i<rest.length;i++)queued.push(rest[i]);
}
function onVisible(island,cb){
  const el=box(island);
  let done=false;
  let io=null;
  const finish=function(){
    if(done)return;
    done=true;
    if(io)io.disconnect();
    cb();
  };
  if('IntersectionObserver' in window){
    io=new IntersectionObserver(function(entries){
      for(let j=0;j<entries.length;j++){
        if(entries[j].isIntersecting||entries[j].intersectionRatio>0){finish();break}
      }
    },{root:null,rootMargin:'0px',threshold:0});
    io.observe(el);
  }
  if(!io||inViewport(el))finish();
  cleanups.push(function(){done=true;if(io)io.disconnect()});
}
function onIdle(cb){
  if('requestIdleCallback' in window){
    const id=requestIdleCallback(function(){cb()},{timeout:2000});
    cleanups.push(function(){cancelIdleCallback(id)});
  }else{
    const tid=setTimeout(cb,200);
    cleanups.push(function(){clearTimeout(tid)});
  }
}
export function scan(root){
  ensureCss();
  const scope=root||document;
  const islands=scope.querySelectorAll?scope.querySelectorAll('deshi-island:not(['+MOUNTED+'="1"])'):[];
  for(let i=0;i<islands.length;i++){(function(island){
    if(island.getAttribute(MOUNTED)==='pending')return;
    const strategy=island.getAttribute('data-strategy')||'load';
    if(strategy==='load')mount(island);
    else if(strategy==='visible')onVisible(island,function(){mount(island)});
    else if(strategy==='idle')onVisible(island,function(){onIdle(function(){mount(island)})});
  })(islands[i])}
}
document.addEventListener('click',function(e){
  if(replaying)return;
  const t=e.target;
  if(!t||!t.closest)return;
  const island=t.closest('deshi-island');
  if(!island)return;
  if(island.getAttribute(MOUNTED)==='1')return;
  queued.push({island:island,el:t.closest('button,[data-inc],a')||t});
  mount(island);
},true);
window.__deshi_scan=scan;
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){scan(document)});
else scan(document);
window.addEventListener('deshi:navigated',function(){cleanup();scan(document)});
`;
