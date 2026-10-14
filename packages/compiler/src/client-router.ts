/**
 * Deshi Client Router — Ultra-fast, zero-dependency SPA navigation.
 */

export interface DeshiNavigateOptions {
  replace?: boolean;
  forceFresh?: boolean;
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

interface CacheEntry {
  p: Promise<{ t: string; u: string }>;
  ts: number;
}

interface DeshiHistoryState {
  x: number;
  y: number;
  i: number;
}

export function initDeshiRouter(): DeshiRouterAPI | undefined {
  if (typeof window === 'undefined') return undefined;
  if (window.deshi) return window.deshi;

  const D = document;
  const L = location;
  const CACHE_LIMIT = 50;
  const CACHE_TTL = 30_000;
  const C = new Map<string, CacheEntry>();
  const loadedScripts = new Set<string>();
  let navId = 0;
  let historyIndex = (history.state && typeof history.state.i === 'number') ? history.state.i : 0;
  let ignoreNextPopstate = false;

  if ('scrollRestoration' in history) {
    history.scrollRestoration = 'manual';
  }

  const NON_HTML_EXT = /\.(?:pdf|zip|tar|gz|tgz|rar|7z|mp4|webm|ogg|mp3|wav|flac|aac|m4a|avi|mov|png|jpe?g|gif|webp|avif|svg|ico|bmp|tiff?|json|xml|rss|atom|csv|txt|wasm|woff2?|ttf|otf|eot|dmg|exe|apk|iso)$/i;

  const getBase = (): string => L.pathname + L.search;
  let currentBase = getBase();
  let currentUrl = currentBase + L.hash;

  let serverHtmlClasses = new Set<string>(Array.from(D.documentElement.classList));
  let serverBodyClasses = new Set<string>(Array.from(D.body ? D.body.classList : []));

  D.querySelectorAll<HTMLScriptElement>('script[src]').forEach((s) => {
    const src = s.getAttribute('src');
    if (src) loadedScripts.add(new URL(src, L.href).href);
  });

  const normalizeUrl = (u: string): string | null => {
    try {
      const a = new URL(u, L.href);
      if (a.origin !== L.origin || !/^https?:$/.test(a.protocol)) return null;
      if (NON_HTML_EXT.test(a.pathname)) return null;
      return a.pathname + a.search + a.hash;
    } catch {
      return null;
    }
  };

  const getEligibleAnchorUrl = (anchor: HTMLAnchorElement | null, forPrefetch: boolean): string | null => {
    if (!anchor) return null;

    const href = anchor.getAttribute('href');
    if (
      !href ||
      (anchor.target && anchor.target !== '_self') ||
      anchor.hasAttribute('download') ||
      /\bexternal\b/i.test(anchor.getAttribute('rel') || '') ||
      anchor.hasAttribute('data-deshi-reload') ||
      anchor.hasAttribute('data-astro-reload') ||
      (forPrefetch && anchor.hasAttribute('data-no-prefetch'))
    ) {
      return null;
    }
    const normalized = normalizeUrl(href);
    if (!normalized) return null;

    if (forPrefetch) {
      const base = normalized.split('#')[0];
      if (base === currentBase) return null;
    }
    return normalized;
  };

  const syncAllAttributes = (target: Element | null, source: Element | null): void => {
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

  const syncRootElement = (
    target: HTMLElement | null,
    source: HTMLElement | null,
    prevServerClasses: Set<string>
  ): Set<string> => {
    if (!target || !source) return prevServerClasses;

    for (const attrName of ['lang', 'dir']) {
      const val = source.getAttribute(attrName);
      if (val !== null) {
        if (target.getAttribute(attrName) !== val) target.setAttribute(attrName, val);
      } else if (target.hasAttribute(attrName)) {
        target.removeAttribute(attrName);
      }
    }

    const nextServerClasses = new Set<string>(Array.from(source.classList));
    prevServerClasses.forEach((cls) => {
      if (!nextServerClasses.has(cls)) target.classList.remove(cls);
    });
    nextServerClasses.forEach((cls) => {
      if (!target.classList.contains(cls)) target.classList.add(cls);
    });

    return nextServerClasses;
  };

  const saveScrollState = (): void => {
    history.replaceState(
      { ...history.state, x: scrollX, y: scrollY, i: historyIndex } as DeshiHistoryState,
      ''
    );
  };

  const findHashElement = (hash: string): Element | null => {
    if (!hash) return null;
    let decoded = hash;
    try {
      decoded = decodeURIComponent(hash);
    } catch {
    }
    return (
      D.getElementById(decoded) ||
      D.getElementById(hash) ||
      D.getElementsByName(decoded)[0] ||
      null
    );
  };

  const fetchPage = (u: string, forceFresh = false): Promise<{ t: string; u: string }> => {
    const key = u.split('#')[0];
    const now = Date.now();
    const cached = C.get(key);

    if (!forceFresh && cached && now - cached.ts < CACHE_TTL) {
      return cached.p;
    }
    if (cached) C.delete(key);

    if (C.size >= CACHE_LIMIT) {
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
        if (!res.ok || !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
          try {
            await res.body?.cancel?.();
          } catch {
          }
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

    C.set(key, { p: promise, ts: now });
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
        prefetchLink.href = href;
        const cleanup = () => prefetchLink.remove();
        prefetchLink.addEventListener('load', cleanup, { once: true });
        prefetchLink.addEventListener('error', cleanup, { once: true });
        setTimeout(cleanup, 10_000);
        D.head.append(prefetchLink);
      }
    }
  };

  const getMetaSignature = (m: Element): string => {
    const parts: string[] = [];
    for (const attr of Array.from(m.attributes)) {
      parts.push(`${attr.name}=${attr.value}`);
    }
    parts.sort();
    return parts.join('&');
  };

  const syncHead = async (doc: Document): Promise<void> => {
    const titleEl = doc.querySelector('title');
    if (titleEl && doc.title) {
      D.title = doc.title;
    }

    serverHtmlClasses = syncRootElement(D.documentElement, doc.documentElement, serverHtmlClasses);

    const existingMetas = Array.from(D.head.querySelectorAll('meta:not([data-deshi-persist])'));
    const keptMetas = new Set<Element>();

    doc.head.querySelectorAll('meta').forEach((newMeta) => {
      const sig = getMetaSignature(newMeta);
      const match = existingMetas.find((oldMeta) => !keptMetas.has(oldMeta) && getMetaSignature(oldMeta) === sig);
      if (match) {
        keptMetas.add(match);
      } else {
        D.head.append(newMeta);
      }
    });

    existingMetas.forEach((oldMeta) => {
      if (!keptMetas.has(oldMeta)) oldMeta.remove();
    });

    const existingStylesheets = Array.from(
      D.head.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]:not([data-deshi-persist])')
    );
    const keptStylesheets = new Set<HTMLLinkElement>();
    const pendingStyles: Promise<unknown>[] = [];

    doc.head.querySelectorAll<HTMLLinkElement>('link[href]').forEach((l) => {
      const rel = (l.getAttribute('rel') || '').trim().toLowerCase();
      const href = l.getAttribute('href');
      if (!href || rel === 'prefetch') return;

      if (rel === 'canonical') {
        const existingCanonical = D.head.querySelector('link[rel="canonical"]');
        if (existingCanonical) existingCanonical.replaceWith(l);
        else D.head.append(l);
        return;
      }

      if (rel === 'stylesheet') {
        const existing = existingStylesheets.find((el) => el.getAttribute('href') === href);
        if (existing) {
          keptStylesheets.add(existing);
        } else {
          pendingStyles.push(
            new Promise((resolve) => {
              l.addEventListener('load', resolve, { once: true });
              l.addEventListener('error', resolve, { once: true });
              setTimeout(resolve, 1000);
            })
          );
          D.head.append(l);
        }
        return;
      }

      const duplicateLink = Array.from(D.head.querySelectorAll('link')).some(
        (el) => el.getAttribute('rel') === rel && el.getAttribute('href') === href
      );
      if (!duplicateLink) {
        D.head.append(l);
      }
    });

    const oldStyles = Array.from(D.head.querySelectorAll('style[data-d]'));
    doc.head.querySelectorAll('style').forEach((s) => {
      s.setAttribute('data-d', '');
      D.head.append(s);
    });

    if (pendingStyles.length > 0) {
      await Promise.all(pendingStyles);
    }

    oldStyles.forEach((s) => s.remove());
    existingStylesheets.forEach((el) => {
      if (!keptStylesheets.has(el)) el.remove();
    });
  };

  const swapBodyOrMain = (doc: Document): HTMLElement => {
    serverBodyClasses = syncRootElement(D.body, doc.body, serverBodyClasses);

    const currentMain = D.querySelector('main');
    const nextMain = doc.querySelector('main');
    const swappedRoot: HTMLElement = currentMain && nextMain ? currentMain : D.body;
    const incomingRoot: HTMLElement = currentMain && nextMain ? nextMain : doc.body;

    if (currentMain && nextMain) {
      syncAllAttributes(currentMain, nextMain);
    }

    const persistedNodes = new Map<string, Element>();
    swappedRoot.querySelectorAll('[data-deshi-persist]').forEach((el) => {
      const id = el.getAttribute('data-deshi-persist') || el.id;
      if (id) persistedNodes.set(id, el);
    });

    const announcer = D.getElementById('deshi-announcer');
    if (announcer && swappedRoot === D.body) {
      persistedNodes.set('__deshi_announcer__', announcer);
    }

    if (persistedNodes.size === 0) {
      swappedRoot.replaceChildren(...Array.from(incomingRoot.childNodes));
      return swappedRoot;
    }

    const directPersisted = new Set<Element>();
    persistedNodes.forEach((el) => {
      if (el.parentElement === swappedRoot) directPersisted.add(el);
    });

    for (const child of Array.from(swappedRoot.childNodes)) {
      if (!(child instanceof Element && directPersisted.has(child))) {
        child.remove();
      }
    }

    for (const incomingChild of Array.from(incomingRoot.childNodes)) {
      if (incomingChild instanceof Element) {
        const persistId = incomingChild.getAttribute('data-deshi-persist') || incomingChild.id;
        if (incomingChild.hasAttribute('data-deshi-persist') && persistId && persistedNodes.has(persistId)) {
          const liveNode = persistedNodes.get(persistId)!;
          const rootWithMove = swappedRoot as HTMLElement & {
            moveBefore?: (node: Node, child: Node | null) => void;
          };
          if (liveNode.parentElement === swappedRoot && typeof rootWithMove.moveBefore === 'function') {
            rootWithMove.moveBefore(liveNode, null);
          } else if (liveNode.parentElement !== swappedRoot) {
            swappedRoot.append(liveNode);
          }
          continue;
        }
      }
      swappedRoot.append(incomingChild);
    }

    swappedRoot.querySelectorAll('[data-deshi-persist]').forEach((placeholder) => {
      const id = placeholder.getAttribute('data-deshi-persist') || placeholder.id;
      const saved = id ? persistedNodes.get(id) : undefined;
      if (saved && saved !== placeholder) {
        const parentWithMove = placeholder.parentElement as (HTMLElement & {
          moveBefore?: (node: Node, child: Node | null) => void;
        }) | null;
        if (parentWithMove && typeof parentWithMove.moveBefore === 'function' && saved.isConnected) {
          parentWithMove.moveBefore(saved, placeholder);
          placeholder.remove();
        } else {
          placeholder.replaceWith(saved);
        }
      }
    });

    directPersisted.forEach((el) => {
      if (el.id === 'deshi-announcer') return;
      const id = el.getAttribute('data-deshi-persist') || el.id;
      const stillPresent =
        id &&
        Array.from(incomingRoot.querySelectorAll('[data-deshi-persist]')).some(
          (n) => (n.getAttribute('data-deshi-persist') || n.id) === id
        );
      if (!stillPresent && !el.hasAttribute('data-deshi-keep')) {
        el.remove();
      }
    });

    if (announcer && !announcer.isConnected) {
      D.body.append(announcer);
    }

    return swappedRoot;
  };

  const executeScripts = (container: HTMLElement, doc: Document): void => {
    const createRunnableScript = (oldScript: HTMLScriptElement): HTMLScriptElement | null => {
      const type = (oldScript.type || '').trim();
      const src = oldScript.getAttribute('src') || '';
      const forceRerun =
        oldScript.hasAttribute('data-deshi-rerun') || oldScript.hasAttribute('data-astro-rerun');

      if (
        oldScript.hasAttribute('data-deshi-no-rerun') ||
        src.includes('/_deshi/router') ||
        (type && !/^(text|application)\/javascript$|^module$/i.test(type))
      ) {
        return null;
      }

      if (src) {
        const absSrc = new URL(src, L.href).href;
        if (loadedScripts.has(absSrc) && !forceRerun) {
          return null;
        }
        loadedScripts.add(absSrc);
      }

      const freshScript = D.createElement('script');
      for (const attr of Array.from(oldScript.attributes)) {
        freshScript.setAttribute(attr.name, attr.value);
      }

      if (!oldScript.hasAttribute('async')) {
        freshScript.async = false;
      }

      const isModule = /^module$/i.test(type);
      const code = oldScript.textContent || '';
      if (!src && code.trim() && !isModule) {
        freshScript.textContent = `{\n${code}\n}`;
      } else {
        freshScript.textContent = code;
      }

      return freshScript;
    };

    container.querySelectorAll<HTMLScriptElement>('script').forEach((oldScript) => {
      if (oldScript.closest('[data-deshi-persist]')) return;
      const freshScript = createRunnableScript(oldScript);
      if (freshScript) {
        oldScript.replaceWith(freshScript);
      }
    });

    D.head.querySelectorAll('script[data-d-rerun]').forEach((s) => s.remove());

    doc.head
      .querySelectorAll<HTMLScriptElement>('script[data-deshi-rerun],script[data-astro-rerun]')
      .forEach((oldScript) => {
        const freshScript = createRunnableScript(oldScript);
        if (freshScript) {
          freshScript.setAttribute('data-d-rerun', '');
          D.head.append(freshScript);
        }
      });
  };

  const manageFocusAndAnnounce = (): void => {
    const autoFocusEl = D.querySelector<HTMLElement>('[autofocus]');
    if (autoFocusEl) {
      autoFocusEl.focus({ preventScroll: true });
    } else {
      const target = D.querySelector<HTMLElement>('main') || D.body;
      if (target) {
        const hadTabIndex = target.hasAttribute('tabindex');
        if (!hadTabIndex) {
          target.setAttribute('tabindex', '-1');
          target.addEventListener(
            'blur',
            () => {
              target.removeAttribute('tabindex');
            },
            { once: true }
          );
        }
        target.focus({ preventScroll: true });
      }
    }

    let announcer = D.getElementById('deshi-announcer');
    if (!announcer && D.body) {
      announcer = D.createElement('div');
      announcer.id = 'deshi-announcer';
      announcer.setAttribute('aria-live', 'polite');
      announcer.setAttribute('aria-atomic', 'true');
      announcer.setAttribute('data-deshi-persist', '__deshi_announcer__');
      announcer.style.cssText =
        'position:fixed;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;';
      D.body.append(announcer);
    }
    if (announcer) {
      const heading = D.querySelector('h1')?.textContent?.trim();
      announcer.textContent = D.title || heading || '';
    }
  };

  const prefetch = (u: string): void => {
    const conn = (navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }).connection;
    if (conn && (conn.saveData || /2g/.test(conn.effectiveType || ''))) return;

    const normalized = normalizeUrl(u);
    if (!normalized) return;
    const key = normalized.split('#')[0];
    if (key === currentBase) return;

    const cached = C.get(key);
    if (cached && Date.now() - cached.ts < CACHE_TTL) return;

    fetchPage(normalized)
      .then(({ t }) => {
        const doc = new DOMParser().parseFromString(t, 'text/html');
        preloadStylesheets(doc);
      })
      .catch(() => {});
  };

  const navigateInternal = async (
    u: string,
    historyMode: 0 | 1 | 2 = 1,
    popState: DeshiHistoryState | null = null,
    forceFresh = false
  ): Promise<void> => {
    const normalized = normalizeUrl(u);
    if (!normalized) return;

    const [base, hash] = normalized.split('#');

    if (base === currentBase && historyMode !== 2 && !forceFresh) {
      const oldFullUrl = L.href;
      saveScrollState();

      if (historyMode === 1 && normalized !== currentUrl) {
        if (hash) {
          L.hash = hash;
          historyIndex++;
          history.replaceState({ x: scrollX, y: scrollY, i: historyIndex } as DeshiHistoryState, '');
        } else {
          historyIndex++;
          history.pushState(
            { x: scrollX, y: scrollY, i: historyIndex } as DeshiHistoryState,
            '',
            normalized
          );
          window.dispatchEvent(
            new HashChangeEvent('hashchange', { oldURL: oldFullUrl, newURL: L.href })
          );
        }
      }

      currentUrl = normalized;
      if (hash) {
        findHashElement(hash)?.scrollIntoView();
      } else if (historyMode === 0 && popState && popState.y != null) {
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
    if (!allowed) {
      if (historyMode === 0) {
        if (popState && typeof popState.i === 'number' && popState.i !== historyIndex) {
          ignoreNextPopstate = true;
          history.go(historyIndex - popState.i);
        } else {
          history.replaceState({ x: scrollX, y: scrollY, i: historyIndex } as DeshiHistoryState, '', currentUrl);
        }
      }
      return;
    }

    const currentNavId = ++navId;
    const prevUrl = currentUrl;
    const prevBase = currentBase;
    const prevIndex = historyIndex;

    try {
      if (historyMode !== 0) {
        saveScrollState();
      }

      const { t, u: finalBase } = await fetchPage(normalized, forceFresh);

      if (currentNavId !== navId) return;

      const finalUrl = finalBase + (hash ? '#' + hash : '');
      const doc = new DOMParser().parseFromString(t, 'text/html');

      D.dispatchEvent(
        new CustomEvent('deshi:before-swap', {
          detail: { newDocument: doc, url: finalUrl },
        })
      );

      if (historyMode === 1) {
        historyIndex++;
        history.pushState({ x: 0, y: 0, i: historyIndex } as DeshiHistoryState, '', finalUrl);
      } else if (historyMode === 2) {
        history.replaceState({ x: 0, y: 0, i: historyIndex } as DeshiHistoryState, '', finalUrl);
      } else if (historyMode === 0) {
        if (popState && typeof popState.i === 'number') {
          historyIndex = popState.i;
        }
        if (finalUrl !== getBase() + L.hash) {
          history.replaceState(
            { ...(popState || { x: 0, y: 0 }), i: historyIndex } as DeshiHistoryState,
            '',
            finalUrl
          );
        }
      }

      currentBase = finalBase;
      currentUrl = finalUrl;

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

      D.dispatchEvent(new Event('deshi:after-swap'));

      const targetEl = hash ? findHashElement(hash) : null;
      if (targetEl) {
        targetEl.scrollIntoView();
      } else if (historyMode === 0 && popState && popState.y != null) {
        scroll(popState.x || 0, popState.y);
      } else {
        scroll(0, 0);
      }

      manageFocusAndAnnounce();

      dispatchEvent(new CustomEvent('deshi:navigated', { detail: finalUrl }));
      D.dispatchEvent(new Event('deshi:page-load'));
    } catch {
      if (currentNavId === navId) {
        currentBase = prevBase;
        currentUrl = prevUrl;
        historyIndex = prevIndex;
        L.href = normalized || u;
      }
    }
  };

  D.addEventListener('click', (e: MouseEvent) => {
    if (e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
      return;
    }
    const target = e.target as Element | null;
    const anchor = target?.closest?.('a') as HTMLAnchorElement | null;
    const normalized = getEligibleAnchorUrl(anchor, false);
    if (!normalized) return;

    e.preventDefault();

    if (normalized === getBase() + L.hash) {
      const hash = normalized.split('#')[1];
      if (hash) findHashElement(hash)?.scrollIntoView();
      else scroll(0, 0);
      return;
    }

    navigateInternal(normalized, anchor!.hasAttribute('data-deshi-replace') ? 2 : 1);
  });

  const handlePrefetchEvent = (e: Event) => {
    const target = e.target as Element | null;
    const anchor = target?.closest?.('a') as HTMLAnchorElement | null;
    const eligibleUrl = getEligibleAnchorUrl(anchor, true);
    if (eligibleUrl) prefetch(eligibleUrl);
  };

  D.addEventListener('pointerover', handlePrefetchEvent, { passive: true });
  D.addEventListener('touchstart', handlePrefetchEvent, { passive: true });
  D.addEventListener('focusin', handlePrefetchEvent, { passive: true });

  D.addEventListener('submit', () => {
    C.clear();
  });

  D.head.querySelectorAll('style').forEach((s) => s.setAttribute('data-d', ''));
  history.replaceState({ ...history.state, x: scrollX, y: scrollY, i: historyIndex } as DeshiHistoryState, '');

  addEventListener('popstate', (e: PopStateEvent) => {
    if (ignoreNextPopstate) {
      ignoreNextPopstate = false;
      return;
    }
    navigateInternal(getBase() + L.hash, 0, e.state as DeshiHistoryState | null);
  });

  const api: DeshiRouterAPI = {
    navigate: (u, opts = {}) =>
      navigateInternal(u, opts.replace ? 2 : 1, null, Boolean(opts.forceFresh)),
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

function computeContentHash(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export const CLIENT_ROUTER_SCRIPT: string = `(${initDeshiRouter.toString()})()`;

export const CLIENT_ROUTER_HASH: string = computeContentHash(CLIENT_ROUTER_SCRIPT);

export const CLIENT_ROUTER_FILENAME: string = `router.${CLIENT_ROUTER_HASH}.js`;

export const CLIENT_ROUTER_PATH: string = `/_deshi/${CLIENT_ROUTER_FILENAME}`;
