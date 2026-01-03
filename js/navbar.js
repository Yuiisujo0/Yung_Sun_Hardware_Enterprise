// js/navbar.js
// Rewritten navbar loader + auth + UI wiring with cart migration/isolation fix.
//
// Behaviors added:
// - When a session is detected, migrate the anonymous cart into a per-user cart if a
//   migration API is available (window.cartAPI.migrateAnonymousToUser).
// - If migrateAnonymousToUser is not available, fallback to moving the anonymous localStorage
//   key ('ys_cart_v1') to a user-scoped key ('ys_cart_v1_user_<userId>') to avoid cart leakage
//   between accounts.
// - After migration/fallback move, dispatch 'cart:changed' so cart UI updates (drawer/badges).
//
// Assumes js/supabase.js initializes window.supabaseClient and may dispatch 'supabase:ready'.

const ROLE_KEY = 'ys_role_v1';
const ROLE_TTL = 1000 * 60 * 5;

/* -------------------- Utilities -------------------- */
function safeQuery(sel, root = document) { try { return root.querySelector(sel); } catch { return null; } }
function safeQueryAll(sel, root = document) { try { return Array.from(root.querySelectorAll(sel)); } catch { return []; } }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/* -------------------- Role cache -------------------- */
function cacheRole(role) {
  try { localStorage.setItem(ROLE_KEY, JSON.stringify({ role, t: Date.now() })); } catch {}
}
function readCachedRole() {
  try {
    const raw = localStorage.getItem(ROLE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj?.t) return null;
    if (Date.now() - obj.t > ROLE_TTL) return null;
    return obj.role || null;
  } catch { return null; }
}

/* -------------------- Admin visibility -------------------- */
function setAdminVisible(isAdmin) {
  const desktop = document.getElementById('adminMenu');
  const mobile = document.getElementById('adminMenuMobile');
  if (desktop) desktop.classList.toggle('hidden', !isAdmin);
  if (mobile) mobile.classList.toggle('hidden', !isAdmin);
}

/* -------------------- Welcome / Logout -------------------- */
function setWelcomeUser(name) {
  const el = document.getElementById('welcomeUser');
  if (!el) return;
  el.textContent = `Welcome back! ${name}`;
  el.classList.remove('hidden');
}
function hideWelcomeUser() {
  const el = document.getElementById('welcomeUser');
  if (el) el.classList.add('hidden');
}
function showLogoutBtn() {
  const btn = document.getElementById('logoutBtn');
  if (!btn) return;
  btn.classList.remove('hidden');
  if (btn._bound) return;
  btn.addEventListener('click', async () => {
    const client = window.supabaseClient;
    if (!client) { window.location.href = 'index.html'; return; }
    try {
      await client.auth.signOut();
      hideLogoutBtn();
      hideWelcomeUser();
      setAdminVisible(false);
      cacheRole('user');
      // optionally clear user-scoped cart on sign-out - commented by default
      // window.cartAPI?.clear();
      window.location.href = 'index.html';
    } catch (err) { console.error('Logout failed', err); }
  });
  btn._bound = true;
}
function hideLogoutBtn() {
  const btn = document.getElementById('logoutBtn');
  if (btn) btn.classList.add('hidden');
}

/* -------------------- Cart migration helpers -------------------- */
const ANON_CART_KEY = 'ys_cart_v1';
function dispatchCartChanged() {
  try {
    document.dispatchEvent(new CustomEvent('cart:changed', { detail: { time: Date.now() } }));
  } catch (e) {}
}

/*
  fallbackMoveAnonCartToUser:
  - If cartAPI.migrateAnonymousToUser is not available, this moves the raw JSON
    from 'ys_cart_v1' to 'ys_cart_v1_user_<userId>' and removes the anon key.
  - Returns true if something was moved, false otherwise.
*/
function fallbackMoveAnonCartToUser(userId) {
  if (!userId) return false;
  try {
    const raw = localStorage.getItem(ANON_CART_KEY);
    if (!raw) return false;
    const userKey = `${ANON_CART_KEY}_user_${userId}`;
    // If user already has a cart key, merge quantities:
    const existingRaw = localStorage.getItem(userKey);
    if (!existingRaw) {
      localStorage.setItem(userKey, raw);
    } else {
      const anon = JSON.parse(raw || '{}');
      const userCart = JSON.parse(existingRaw || '{}');
      Object.keys(anon).forEach(k => {
        if (!anon[k] || !anon[k].id) return;
        if (userCart[k]) {
          userCart[k].qty = (Number(userCart[k].qty || 0) + Number(anon[k].qty || 0));
        } else {
          userCart[k] = anon[k];
        }
      });
      localStorage.setItem(userKey, JSON.stringify(userCart));
    }
    // remove anonymous cart to prevent leakage
    localStorage.removeItem(ANON_CART_KEY);
    return true;
  } catch (err) {
    console.warn('fallbackMoveAnonCartToUser failed', err);
    return false;
  }
}

/* -------------------- Auth initialization -------------------- */
async function initAuthAndRole() {
  const client = window.supabaseClient;
  if (!client) {
    // Use cached role if available
    const cached = readCachedRole();
    if (cached) setAdminVisible(cached === 'admin');
    hideWelcomeUser();
    hideLogoutBtn();
    return;
  }

  try {
    const { data: { session } } = await client.auth.getSession();
    const profileAnchor = document.querySelector('a[aria-label="User Profile"], a[href="profile.html"]');

    if (!session) {
      if (profileAnchor) profileAnchor.setAttribute('href', 'signin.html');
      setAdminVisible(false);
      hideWelcomeUser();
      hideLogoutBtn();
      cacheRole('user');
      // On signed-out state we may want to show anon cart - nothing else necessary
      return;
    }

    // Logged in: ensure profile link points to profile
    if (profileAnchor) {
      profileAnchor.setAttribute('href', 'profile.html');
      profileAnchor.title = session.user.email || '';
    }

    // Attempt to migrate/associate anonymous cart into user's cart to avoid leakage
    try {
      if (window.cartAPI?.migrateAnonymousToUser) {
        // preferred flow if cart module implements migration
        await window.cartAPI.migrateAnonymousToUser(session.user.id);
        // cart module should fire cart change events; ensure UI updated
        dispatchCartChanged();
      } else {
        // fallback: move anon raw storage into user-scoped key
        const moved = fallbackMoveAnonCartToUser(session.user.id);
        if (moved) dispatchCartChanged();
      }
    } catch (err) {
      console.warn('Cart migration attempt failed', err);
    }

    // Load profile row (role, full_name)
    const { data: profile, error } = await client
      .from('profiles')
      .select('role, full_name')
      .eq('user_id', session.user.id)
      .single();

    const displayName = profile?.full_name ||
      session.user.user_metadata?.full_name ||
      (session.user.email ? session.user.email.split('@')[0] : 'User');

    setWelcomeUser(displayName);
    showLogoutBtn();

    const role = profile?.role || 'user';
    setAdminVisible(role === 'admin');
    cacheRole(role);
  } catch (err) {
    console.error('initAuthAndRole failed', err);
  }
}

/* -------------------- Auth state listener -------------------- */
function bindAuthListener() {
  const client = window.supabaseClient;
  if (!client) return;
  if (window.__ysAuthListenerBound) return;
  window.__ysAuthListenerBound = true;

  client.auth.onAuthStateChange(async (event) => {
    console.log('[Auth change]', event);

    if (event === 'SIGNED_OUT') {
      // On sign out: hide admin UI and welcome; leave anon cart in place (so browser retains it).
      // If you prefer to clear cart on sign-out, uncomment the next line:
      // window.cartAPI?.clear?.();
      setAdminVisible(false);
      hideWelcomeUser();
      hideLogoutBtn();
      cacheRole('user');
      dispatchCartChanged(); // notify listeners that cart context may have changed
      return;
    }

    // On sign-in or other auth change, re-init auth UI and attempt cart migration
    await initAuthAndRole();
  });
}

/* -------------------- Profile link handling (prevent flash) -------------------- */
function bindProfileLinkClicks() {
  const selector = 'a[aria-label="User Profile"], a[href="profile.html"], a[href*="profile.html"]';

  async function handleClick(e) {
    const anchor = e.currentTarget || e.target.closest('a');
    if (!anchor) return;
    e.preventDefault();
    e.stopPropagation();

    // Wait briefly for supabase client to be ready (if it's initializing)
    const waitForClient = async (timeout = 800) => {
      const start = Date.now();
      while (!window.supabaseClient && (Date.now() - start < timeout)) {
        await sleep(70);
      }
      return !!window.supabaseClient;
    };

    await waitForClient();

    let isLoggedIn = false;
    try {
      if (window.supabaseClient) {
        const { data: { session } } = await window.supabaseClient.auth.getSession();
        isLoggedIn = !!session;
      }
    } catch (err) {
      console.warn('profile session check failed', err);
    }

    if (isLoggedIn) window.location.href = 'profile.html';
    else window.location.href = 'signin.html';
  }

  function attachAll(root = document) {
    safeQueryAll(selector, root).forEach(a => {
      if (!a._profileBound) {
        a.addEventListener('click', handleClick);
        a._profileBound = true;
      }
    });
  }

  attachAll();
  document.addEventListener('navbar:ready', () => attachAll());
}

/* -------------------- Small UI wiring -------------------- */
function initSmallUI() {
  // Mobile menu toggle
  const menuBtn = document.getElementById('menuBtn');
  const mobileMenu = document.getElementById('mobileMenu');
  if (menuBtn && mobileMenu && !menuBtn._bound) {
    const icon = menuBtn.querySelector('i');
    menuBtn.addEventListener('click', () => {
      mobileMenu.classList.toggle('hidden');
      mobileMenu.classList.toggle('-translate-y-full');
      if (icon) { icon.classList.toggle('bx-menu'); icon.classList.toggle('bx-x'); }
      document.body.classList.toggle('overflow-hidden');
    });

    // close on link click
    safeQueryAll('a', mobileMenu).forEach(link => {
      link.addEventListener('click', () => {
        mobileMenu.classList.add('hidden', '-translate-y-full');
        if (icon) { icon.classList.add('bx-menu'); icon.classList.remove('bx-x'); }
        document.body.classList.remove('overflow-hidden');
      });
    });

    menuBtn._bound = true;
  }

  // Navbar shadow on scroll
  const navbar = document.getElementById('navbar');
  if (navbar && !navbar._shadowBound) {
    window.addEventListener('scroll', () => navbar.classList.toggle('shadow-md', window.scrollY > 10));
    navbar._shadowBound = true;
  }

  // Desktop dropdown hover (Home)
  const dropdownButton = document.querySelector('#navbar .group');
  const dropdownMenu = dropdownButton?.querySelector('div');
  if (dropdownButton && dropdownMenu && !dropdownButton._dropdownBound) {
    const show = () => {
      dropdownMenu.classList.remove('opacity-0','visibility-hidden','pointer-events-none');
      dropdownMenu.classList.add('opacity-100','visibility-visible','pointer-events-auto');
    };
    const hide = () => {
      dropdownMenu.classList.remove('opacity-100','visibility-visible','pointer-events-auto');
      dropdownMenu.classList.add('opacity-0','visibility-hidden','pointer-events-none');
    };
    dropdownButton.addEventListener('mouseenter', show);
    dropdownButton.addEventListener('mouseleave', () => setTimeout(() => !dropdownMenu.matches(':hover') && hide(), 100));
    dropdownMenu.addEventListener('mouseenter', show);
    dropdownMenu.addEventListener('mouseleave', hide);
    dropdownButton._dropdownBound = true;
  }

  // Active item highlight
  highlightActiveNav();
}

/* -------------------- Highlight active nav item -------------------- */
function highlightActiveNav() {
  try {
    const path = window.location.pathname.split('/').pop() || 'index.html';
    const isIndexWithHash = path === 'index.html' && location.hash;
    const mapping = {
      home: ['index.html',''],
      shop: ['shop.html','product-details.html'],
      admin: ['admin.html','inventory.html']
    };

    // clear
    safeQueryAll('#navbar a, #navbar button, #mobileMenu a').forEach(el => {
      el.classList.remove('text-[#f8941e]','font-semibold');
      const icon = el.querySelector('i');
      if (icon) icon.classList.remove('text-[#f8941e]','font-semibold');
    });

    const apply = (el) => {
      if (!el) return;
      el.classList.add('text-[#f8941e]','font-semibold');
      const icon = el.querySelector('i');
      if (icon) icon.classList.add('text-[#f8941e]');
    };

    if (mapping.home.includes(path) || isIndexWithHash) {
      apply(safeQuery('.group > button') || safeQuery('#navbar a[href="index.html"]'));
      apply(safeQuery('#mobileMenu a[href^="index.html#"], #mobileMenu a[href="index.html"]'));
      return;
    }
    if (mapping.shop.includes(path) || window.location.pathname.includes('product-details')) {
      apply(safeQuery('#navbar a[href="shop.html"]'));
      apply(safeQuery('#mobileMenu a[href="shop.html"]'));
      return;
    }
    if (mapping.admin.includes(path)) {
      apply(document.getElementById('adminMenu') || safeQuery('#navbar a[href="admin.html"]'));
      apply(document.getElementById('adminMenuMobile') || safeQuery('#mobileMenu a[href="admin.html"]'));
      return;
    }
  } catch (err) {
    console.warn('highlightActiveNav failed', err);
  }
}

/* -------------------- Navbar HTML fetcher -------------------- */
async function tryFetchNavbar(paths = ['./navbar.html','/navbar.html','navbar.html']) {
  for (const p of paths) {
    try {
      const resp = await fetch(p, { cache: 'no-store' });
      if (resp.ok) return await resp.text();
    } catch {}
  }
  return null;
}

/* -------------------- Start / bootstrap -------------------- */
async function startNavbar() {
  const root = document.getElementById('navbar-root');
  const existing = document.getElementById('navbar');

  // If navbar already on page, initialize UI and auth
  if (existing && existing.children.length > 0) {
    initSmallUI();
    await waitForSupabaseThenInit();
    document.dispatchEvent(new CustomEvent('navbar:ready'));
    return;
  }

  // Try to fetch navbar markup and inject it
  if (root) {
    const html = await tryFetchNavbar();
    if (html) {
      root.innerHTML = html;
      // slight tick to let DOM settle
      await Promise.resolve();
      initSmallUI();
      await waitForSupabaseThenInit();
      document.dispatchEvent(new CustomEvent('navbar:ready'));
      return;
    }
  }

  // Fallback: still initialize UI + auth
  initSmallUI();
  await waitForSupabaseThenInit();
  document.dispatchEvent(new CustomEvent('navbar:ready'));
}

/* Helper: Wait for supabase client then init auth-related bindings */
async function waitForSupabaseThenInit() {
  // If supabase client already exists, run immediately
  if (window.supabaseClient) {
    await initAuthAndRole();
    bindAuthListener();
    bindProfileLinkClicks();
    bindLogout(); // ensures logout button bound if present
    return;
  }
  // Else wait for a short period or event
  let resolved = false;
  function onReady() { resolved = true; }
  document.addEventListener('supabase:ready', onReady, { once: true });

  // poll for up to ~2s
  const start = Date.now();
  while (!window.supabaseClient && !resolved && Date.now() - start < 2000) {
    await sleep(100);
  }
  document.removeEventListener('supabase:ready', onReady);
  // initialize whatever we have
  await initAuthAndRole();
  bindAuthListener();
  bindProfileLinkClicks();
  bindLogout();
}

/* -------------------- Legacy bindLogout (keeps compatibility) -------------------- */
function bindLogout() {
  const btn = document.getElementById('logoutBtn');
  if (!btn || btn._bound) return;
  btn.addEventListener('click', async () => {
    const client = window.supabaseClient;
    if (!client) { window.location.href = 'index.html'; return; }
    try {
      await client.auth.signOut();
      hideLogoutBtn();
      hideWelcomeUser();
      setAdminVisible(false);
      cacheRole('user');
      // optionally clear cart on logout:
      // if (window.cartAPI?.clear) window.cartAPI.clear();
      dispatchCartChanged();
      window.location.href = 'index.html';
    } catch (err) { console.error('Logout failed:', err); }
  });
  btn._bound = true;
}

/* -------------------- Kickoff -------------------- */
document.addEventListener('DOMContentLoaded', startNavbar);