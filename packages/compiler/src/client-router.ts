/**
 * Deshi Client Router — Ultra-fast, zero-dependency SPA navigation.
 * Served as /_deshi/router.4f1a9c2e.js.
 */

export const CLIENT_ROUTER_SCRIPT = `(()=>{if(window.deshi)return;let D=document,L=location,C=new Map,I=0,S=p=>p.length>1&&p.endsWith('/')?p.slice(0,-1):p,B=()=>S(L.pathname)+L.search,U=B(),N=u=>{try{let a=new URL(u,L);return a.origin==L.origin&&/^https?:$/.test(a.protocol)?S(a.pathname)+a.search+a.hash:0}catch{return 0}},K=m=>m.getAttribute('name')?'n:'+m.getAttribute('name'):m.getAttribute('property')?'p:'+m.getAttribute('property'):m.getAttribute('http-equiv')?'h:'+m.getAttribute('http-equiv'):m.hasAttribute('charset')?'c':0,A=(t,s)=>{if(!t||!s)return;for(let a of[...t.attributes])s.hasAttribute(a.name)||t.removeAttribute(a.name);for(let a of s.attributes)t.getAttribute(a.name)!==a.value&&t.setAttribute(a.name,a.value)},V=()=>history.replaceState({...history.state,x:scrollX,y:scrollY},''),G=h=>{if(!h)return 0;let d=h;try{d=decodeURIComponent(h)}catch{}return D.getElementById(d)||D.getElementById(h)||D.getElementsByName(d)[0]},F=u=>{let k=u.split('#')[0];if(C.has(k))return C.get(k);if(C.size>50)C.delete(C.keys().next().value);let p=fetch(k,{headers:{'X-Deshi-Router':'1',Accept:'text/html,application/xhtml+xml'}}).then(async r=>{if(!r.ok||!(r.headers.get('content-type')||'').includes('html'))throw 0;let f=r.redirected?N(r.url):k;if(!f)throw 0;return{t:await r.text(),u:f.split('#')[0]}}).catch(e=>{C.delete(k);throw e});C.set(k,p);return p},Y=q=>{for(let l of q.querySelectorAll('link[rel="stylesheet"][href]')){let h=l.getAttribute('href');if(h&&![...D.head.querySelectorAll('link')].some(e=>e.getAttribute('href')===h)){let p=D.createElement('link');p.rel='prefetch';p.as='style';p.href=h;D.head.append(p)}}},H=async q=>{if(q.title!=null)D.title=q.title;A(D.documentElement,q.documentElement);let om=new Map;D.head.querySelectorAll('meta').forEach(m=>{let k=K(m);if(k)om.set(k,m)});q.head.querySelectorAll('meta').forEach(m=>{let k=K(m);if(k){let o=om.get(k);if(o){o.replaceWith(m);om.delete(k)}else D.head.append(m)}});om.forEach(m=>m.remove());D.head.querySelectorAll('style[data-d]').forEach(s=>s.remove());q.head.querySelectorAll('style').forEach(s=>{s.setAttribute('data-d','');D.head.append(s)});let w=[];q.head.querySelectorAll('link[href]').forEach(l=>{let r=l.getAttribute('rel')||'',h=l.getAttribute('href');if(r==='canonical'){let o=D.head.querySelector('link[rel="canonical"]');o?o.replaceWith(l):D.head.append(l)}else if(r!=='prefetch'&&![...D.head.querySelectorAll('link')].some(e=>e.getAttribute('rel')===r&&e.getAttribute('href')===h)){if(r==='stylesheet')w.push(new Promise(v=>{l.onload=l.onerror=v;setTimeout(v,1e3)}));D.head.append(l)}});if(w.length)await Promise.all(w)},W=q=>{A(D.body,q.body);let pm=new Map;D.querySelectorAll('[data-deshi-persist]').forEach(el=>{let id=el.getAttribute('data-deshi-persist')||el.id;if(id)pm.set(id,el)});let e=D.querySelector('main'),t=q.querySelector('main'),r=D.body;if(e&&t){A(e,t);e.replaceChildren(...t.childNodes);r=e}else D.body.replaceChildren(...q.body.childNodes);if(pm.size)r.querySelectorAll('[data-deshi-persist]').forEach(el=>{let id=el.getAttribute('data-deshi-persist')||el.id,o=pm.get(id);if(o)el.replaceWith(o)});return r},X=(r,q)=>{let run=o=>{let t=o.type,s=o.getAttribute('src')||'';if(o.hasAttribute('data-deshi-no-rerun')||s.includes('/_deshi/router')||t&&!/^(text|application)\\/javascript$|^module$/i.test(t))return;let n=D.createElement('script');for(let a of o.attributes)n.setAttribute(a.name,a.value);n.textContent=o.textContent;o.replaceWith(n)};r.querySelectorAll('script').forEach(run);q.head.querySelectorAll('script[data-deshi-rerun],script[data-astro-rerun]').forEach(o=>{let n=D.createElement('script');for(let a of o.attributes)n.setAttribute(a.name,a.value);n.textContent=o.textContent;D.head.append(n)})},P=u=>{let c=navigator.connection;if(c&&(c.saveData||/2g/.test(c.effectiveType)))return;let n=N(u);if(!n||C.has(n.split('#')[0]))return;F(n).then(({t})=>Y(new DOMParser().parseFromString(t,'text/html'))).catch(()=>{})},R=()=>{if(L.pathname.length>1&&L.pathname.endsWith('/'))history.replaceState(history.state,'',B()+L.hash)},T=async(u,k=1,st=0)=>{let n=N(u);if(!n)return;let[b,h]=n.split('#');if(b===U&&k!==2){V();if(k===1)history.pushState({x:scrollX,y:scrollY},'',n);if(h)G(h)?.scrollIntoView();else if(st&&st.y!=null)scroll(st.x||0,st.y);else scroll(0,0);dispatchEvent(new CustomEvent('deshi:navigated',{detail:n}));return}if(!D.dispatchEvent(new CustomEvent('deshi:before-navigate',{detail:n,cancelable:true})))return;let id=++I;try{V();let{t,u:fu}=await F(n);if(id!==I)return;let fn=fu+(h?'#'+h:''),q=new DOMParser().parseFromString(t,'text/html');D.dispatchEvent(new CustomEvent('deshi:before-swap',{detail:{newDocument:q,url:fn}}));let sw=async()=>{await H(q);let r=W(q);X(r,q)};if(D.startViewTransition&&D.querySelector('meta[name="view-transition"],[data-deshi-transition]'))await D.startViewTransition(sw).updateCallbackDone;else await sw();if(id!==I)return;U=fu;R();if(k===1)history.pushState({x:0,y:0},'',fn);else if(k===2)history.replaceState({x:0,y:0},'',fn);D.dispatchEvent(new Event('deshi:after-swap'));let el=h&&G(h);if(el)el.scrollIntoView();else if(!k&&st&&st.y!=null)scroll(st.x||0,st.y);else scroll(0,0);(D.querySelector('[autofocus]')||D.body)?.focus?.({preventScroll:true});dispatchEvent(new CustomEvent('deshi:navigated',{detail:fn}));D.dispatchEvent(new Event('deshi:page-load'))}catch{if(id===I)L.href=n||u}};D.addEventListener('click',e=>{if(e.defaultPrevented||e.button||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;let a=e.target?.closest?.('a');if(!a)return;let hr=a.getAttribute('href');if(!hr||a.target&&a.target!=='_self'||a.hasAttribute('download')||/\\bexternal\\b/i.test(a.getAttribute('rel')||'')||a.hasAttribute('data-deshi-reload')||a.hasAttribute('data-astro-reload'))return;let n=N(hr);if(!n||n===B()+L.hash)return;e.preventDefault();T(n,a.hasAttribute('data-deshi-replace')?2:1)});let pre=e=>{let a=e.target?.closest?.('a');if(!a||a.hasAttribute('data-no-prefetch'))return;let hr=a.getAttribute('href');if(hr)P(hr)};D.addEventListener('pointerover',pre,{passive:true});D.addEventListener('touchstart',pre,{passive:true});D.addEventListener('focusin',pre,{passive:true});D.head.querySelectorAll('style').forEach(s=>s.setAttribute('data-d',''));R();U=B();addEventListener('popstate',e=>T(B()+L.hash,0,e.state));window.deshi={navigate:(u,o={})=>T(u,o.replace?2:1),prefetch:P,clearCache:u=>u?C.delete(N(u)?.split('#')[0]):C.clear()};D.dispatchEvent(new Event('deshi:page-load'))})()`;

export interface DeshiNavigateOptions {
  replace?: boolean;
}

export interface DeshiRouterAPI {
  navigate: (url: string, options?: DeshiNavigateOptions) => Promise<void>;
  prefetch: (url: string) => void;
  clearCache: (url?: string) => void;
}

declare global {
  interface Window {
    deshi?: DeshiRouterAPI;
  }
}

export function initDeshiRouter(): DeshiRouterAPI | undefined {
  if (typeof window === 'undefined') return undefined;
  if (window.deshi) return window.deshi;

  const D = document;
  const L = location;
  const CACHE_LIMIT = 50;
  const C = new Map<string, Promise<{ t: string; u: string }>>();
  let navId = 0;

  const stripSlash = (p: string): string =>
    p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p;

  const getBase = (): string => stripSlash(L.pathname) + L.search;
  let currentBase = getBase();

  const normalizeUrl = (u: string): string | 0 => {
    try {
      const a = new URL(u, L.href);
      return a.origin === L.origin && /^https?:$/.test(a.protocol)
        ? stripSlash(a.pathname) + a.search + a.hash
        : 0;
    } catch {
      return 0;
    }
  };

  const getMetaKey = (m: Element): string | 0 =>
    m.getAttribute('name')
      ? 'n:' + m.getAttribute('name')
      : m.getAttribute('property')
        ? 'p:' + m.getAttribute('property')
        : m.getAttribute('http-equiv')
          ? 'h:' + m.getAttribute('http-equiv')
          : m.hasAttribute('charset')
            ? 'c'
            : 0;


  const syncAttributes = (target: Element | null, source: Element | null): void => {
    if (!target || !source) return;
    for (const attr of Array.from(target.attributes)) {
      if (!source.hasAttribute(attr.name)) {
        target.removeAttribute(attr.name);
      }
    }
    for (const attr of Array.from(source.attributes)) {
      if (target.getAttribute(attr.name) !== attr.value) {
        target.setAttribute(attr.name, attr.value);
      }
    }
  };

  const saveScrollState = (): void => {
    history.replaceState({ ...history.state, x: scrollX, y: scrollY }, '');
  };

  const findHashElement = (hash: string): Element | null => {
    if (!hash) return null;
    let decoded = hash;
    try {
      decoded = decodeURIComponent(hash);
    } catch {
      // Keep raw hash if malformed percent encoding
    }
    return (
      D.getElementById(decoded) ||
      D.getElementById(hash) ||
      D.getElementsByName(decoded)[0] ||
      null
    );
  };

  const fetchPage = (u: string): Promise<{ t: string; u: string }> => {
    const key = u.split('#')[0];
    const cached = C.get(key);
    if (cached) return cached;

    if (C.size > CACHE_LIMIT) {
      const oldestKey = C.keys().next().value;
      if (oldestKey) C.delete(oldestKey);
    }

    const promise = fetch(key, {
      headers: {
        'X-Deshi-Router': '1',
        Accept: 'text/html,application/xhtml+xml',
      },
    })
      .then(async (res) => {
        const contentType = res.headers.get('content-type') || '';
        if (!res.ok || !contentType.includes('html')) {
          throw new Error('Non-HTML or error response');
        }
        const finalUrl = res.redirected ? normalizeUrl(res.url) : key;
        if (!finalUrl) {
          throw new Error('Redirected to external origin');
        }
        return {
          t: await res.text(),
          u: finalUrl.split('#')[0],
        };
      })
      .catch((err) => {
        C.delete(key);
        throw err;
      });

    C.set(key, promise);
    return promise;
  };

  const preloadStylesheets = (doc: Document): void => {
    for (const link of Array.from(doc.querySelectorAll('link[rel="stylesheet"][href]'))) {
      const href = link.getAttribute('href');
      if (
        href &&
        !Array.from(D.head.querySelectorAll('link')).some((el) => el.getAttribute('href') === href)
      ) {
        const prefetchLink = D.createElement('link');
        prefetchLink.rel = 'prefetch';
        prefetchLink.as = 'style';
        prefetchLink.href = href;
        D.head.append(prefetchLink);
      }
    }
  };

  const syncHead = async (doc: Document): Promise<void> => {
    if (doc.title != null) D.title = doc.title;
    syncAttributes(D.documentElement, doc.documentElement);

    // Diff & sync <meta> tags
    const oldMetas = new Map<string, Element>();
    D.head.querySelectorAll('meta').forEach((m) => {
      const k = getMetaKey(m);
      if (k) oldMetas.set(k, m);
    });

    doc.head.querySelectorAll('meta').forEach((m) => {
      const k = getMetaKey(m);
      if (k) {
        const existing = oldMetas.get(k);
        if (existing) {
          existing.replaceWith(m);
          oldMetas.delete(k);
        } else {
          D.head.append(m);
        }
      }
    });
    oldMetas.forEach((m) => m.remove());

    D.head.querySelectorAll('style[data-d]').forEach((s) => s.remove());
    doc.head.querySelectorAll('style').forEach((s) => {
      s.setAttribute('data-d', '');
      D.head.append(s);
    });

    const pendingStyles: Promise<unknown>[] = [];
    doc.head.querySelectorAll('link[href]').forEach((l) => {
      const rel = l.getAttribute('rel') || '';
      const href = l.getAttribute('href');

      if (rel === 'canonical') {
        const existingCanonical = D.head.querySelector('link[rel="canonical"]');
        if (existingCanonical) existingCanonical.replaceWith(l);
        else D.head.append(l);
      } else if (
        rel !== 'prefetch' &&
        !Array.from(D.head.querySelectorAll('link')).some(
          (el) => el.getAttribute('rel') === rel && el.getAttribute('href') === href
        )
      ) {
        if (rel === 'stylesheet') {
          pendingStyles.push(
            new Promise((resolve) => {
              l.addEventListener('load', resolve, { once: true });
              l.addEventListener('error', resolve, { once: true });
              setTimeout(resolve, 1000);
            })
          );
        }
        D.head.append(l);
      }
    });

    if (pendingStyles.length > 0) {
      await Promise.all(pendingStyles);
    }
  };


  const swapBodyOrMain = (doc: Document): HTMLElement => {
    syncAttributes(D.body, doc.body);

    const persistedNodes = new Map<string, Element>();
    D.querySelectorAll('[data-deshi-persist]').forEach((el) => {
      const id = el.getAttribute('data-deshi-persist') || el.id;
      if (id) persistedNodes.set(id, el);
    });

    const currentMain = D.querySelector('main');
    const nextMain = doc.querySelector('main');
    let swappedRoot: HTMLElement = D.body;

    if (currentMain && nextMain) {
      syncAttributes(currentMain, nextMain);
      currentMain.replaceChildren(...Array.from(nextMain.childNodes));
      swappedRoot = currentMain;
    } else {
      D.body.replaceChildren(...Array.from(doc.body.childNodes));
    }

    if (persistedNodes.size > 0) {
      swappedRoot.querySelectorAll('[data-deshi-persist]').forEach((el) => {
        const id = el.getAttribute('data-deshi-persist') || el.id;
        const saved = id ? persistedNodes.get(id) : undefined;
        if (saved) el.replaceWith(saved);
      });
    }

    return swappedRoot;
  };

  const executeScripts = (container: HTMLElement, doc: Document): void => {
    const runScript = (oldScript: HTMLScriptElement) => {
      const type = oldScript.type;
      const src = oldScript.getAttribute('src') || '';
      if (
        oldScript.hasAttribute('data-deshi-no-rerun') ||
        src.includes('/_deshi/router') ||
        (type && !/^(text|application)\/javascript$|^module$/i.test(type))
      ) {
        return;
      }
      const freshScript = D.createElement('script');
      for (const attr of Array.from(oldScript.attributes)) {
        freshScript.setAttribute(attr.name, attr.value);
      }
      freshScript.textContent = oldScript.textContent;
      oldScript.replaceWith(freshScript);
    };

    container.querySelectorAll('script').forEach(runScript);

    doc.head
      .querySelectorAll<HTMLScriptElement>('script[data-deshi-rerun],script[data-astro-rerun]')
      .forEach((oldScript) => {
        const freshScript = D.createElement('script');
        for (const attr of Array.from(oldScript.attributes)) {
          freshScript.setAttribute(attr.name, attr.value);
        }
        freshScript.textContent = oldScript.textContent;
        D.head.append(freshScript);
      });
  };

  const prefetch = (u: string): void => {
    const conn = (navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }).connection;
    if (conn && (conn.saveData || /2g/.test(conn.effectiveType || ''))) return;

    const normalized = normalizeUrl(u);
    if (!normalized || C.has(normalized.split('#')[0])) return;

    fetchPage(normalized)
      .then(({ t }) => {
        const doc = new DOMParser().parseFromString(t, 'text/html');
        preloadStylesheets(doc);
      })
      .catch(() => {});
  };


  const normalizeCurrentHistory = (): void => {
    if (L.pathname.length > 1 && L.pathname.endsWith('/')) {
      history.replaceState(history.state, '', getBase() + L.hash);
    }
  };

  /**
   * Core navigation handler.
   * @param u Target URL
   * @param historyMode 0 = popstate, 1 = pushState, 2 = replaceState
   * @param popState Optional history state object from popstate event
   */
  const navigateInternal = async (
    u: string,
    historyMode: 0 | 1 | 2 = 1,
    popState: { x?: number; y?: number } | null = null
  ): Promise<void> => {
    const normalized = normalizeUrl(u);
    if (!normalized) return;

    const [base, hash] = normalized.split('#');

    if (base === currentBase && historyMode !== 2) {
      saveScrollState();
      if (historyMode === 1) {
        history.pushState({ x: scrollX, y: scrollY }, '', normalized);
      }
      if (hash) {
        findHashElement(hash)?.scrollIntoView();
      } else if (popState && popState.y != null) {
        scroll(popState.x || 0, popState.y);
      } else {
        scroll(0, 0);
      }
      dispatchEvent(new CustomEvent('deshi:navigated', { detail: normalized }));
      return;
    }

    const allowed = D.dispatchEvent(
      new CustomEvent('deshi:before-navigate', {
        detail: normalized,
        cancelable: true,
      })
    );
    if (!allowed) return;

    const currentNavId = ++navId;

    try {
      saveScrollState();
      const { t, u: finalBase } = await fetchPage(normalized);

      if (currentNavId !== navId) return;

      const finalUrl = finalBase + (hash ? '#' + hash : '');
      const doc = new DOMParser().parseFromString(t, 'text/html');

      D.dispatchEvent(
        new CustomEvent('deshi:before-swap', {
          detail: { newDocument: doc, url: finalUrl },
        })
      );

      const performSwap = async () => {
        await syncHead(doc);
        const swappedRoot = swapBodyOrMain(doc);
        executeScripts(swappedRoot, doc);
      };

      const docWithVT = D as Document & {
        startViewTransition?: (cb: () => Promise<void>) => { updateCallbackDone: Promise<void> };
      };

      if (
        docWithVT.startViewTransition &&
        D.querySelector('meta[name="view-transition"],[data-deshi-transition]')
      ) {
        await docWithVT.startViewTransition(performSwap).updateCallbackDone;
      } else {
        await performSwap();
      }

      if (currentNavId !== navId) return;

      currentBase = finalBase;
      normalizeCurrentHistory();

      if (historyMode === 1) {
        history.pushState({ x: 0, y: 0 }, '', finalUrl);
      } else if (historyMode === 2) {
        history.replaceState({ x: 0, y: 0 }, '', finalUrl);
      }

      D.dispatchEvent(new Event('deshi:after-swap'));

      const targetEl = hash ? findHashElement(hash) : null;
      if (targetEl) {
        targetEl.scrollIntoView();
      } else if (historyMode === 0 && popState && popState.y != null) {
        scroll(popState.x || 0, popState.y);
      } else {
        scroll(0, 0);
      }

      const focusTarget = D.querySelector<HTMLElement>('[autofocus]') || D.body;
      focusTarget?.focus?.({ preventScroll: true });

      dispatchEvent(new CustomEvent('deshi:navigated', { detail: finalUrl }));
      D.dispatchEvent(new Event('deshi:page-load'));
    } catch {
      if (currentNavId === navId) {
        L.href = normalized || u;
      }
    }
  };

  D.addEventListener('click', (e: MouseEvent) => {
    if (e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
      return;
    }
    const target = e.target as Element | null;
    const anchor = target?.closest?.('a');
    if (!anchor) return;

    const href = anchor.getAttribute('href');
    if (
      !href ||
      (anchor.target && anchor.target !== '_self') ||
      anchor.hasAttribute('download') ||
      /\bexternal\b/i.test(anchor.getAttribute('rel') || '') ||
      anchor.hasAttribute('data-deshi-reload') ||
      anchor.hasAttribute('data-astro-reload')
    ) {
      return;
    }

    const normalized = normalizeUrl(href);
    if (!normalized || normalized === getBase() + L.hash) return;

    e.preventDefault();
    navigateInternal(normalized, anchor.hasAttribute('data-deshi-replace') ? 2 : 1);
  });

  const handlePrefetchEvent = (e: Event) => {
    const target = e.target as Element | null;
    const anchor = target?.closest?.('a');
    if (!anchor || anchor.hasAttribute('data-no-prefetch')) return;
    const href = anchor.getAttribute('href');
    if (href) prefetch(href);
  };

  D.addEventListener('pointerover', handlePrefetchEvent, { passive: true });
  D.addEventListener('touchstart', handlePrefetchEvent, { passive: true });
  D.addEventListener('focusin', handlePrefetchEvent, { passive: true });

  D.head.querySelectorAll('style').forEach((s) => s.setAttribute('data-d', ''));
  normalizeCurrentHistory();
  currentBase = getBase();

  addEventListener('popstate', (e: PopStateEvent) => {
    navigateInternal(getBase() + L.hash, 0, e.state);
  });

  const api: DeshiRouterAPI = {
    navigate: (u, opts = {}) => navigateInternal(u, opts.replace ? 2 : 1),
    prefetch,
    clearCache: (u) => {
      if (u) {
        const norm = normalizeUrl(u);
        if (norm) C.delete(norm.split('#')[0]);
      } else {
        C.clear();
      }
    },
  };

  window.deshi = api;
  D.dispatchEvent(new Event('deshi:page-load'));
  return api;
}
