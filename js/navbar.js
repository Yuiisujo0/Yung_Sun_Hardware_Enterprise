// navbar.js
const ROLE_KEY = 'ys_role_v1';
const ROLE_TTL = 1000 * 60 * 5;

/* -------------------- Admin visibility -------------------- */
function setAdminVisible(isAdmin) {
  const desktop = document.getElementById('adminMenu');
  const mobile = document.getElementById('adminMenuMobile');
  if (desktop) desktop.classList.toggle('hidden', !isAdmin);
  if (mobile) mobile.classList.toggle('hidden', !isAdmin);
}

/* -------------------- Role cache -------------------- */
function cacheRole(role) {
  try {
    localStorage.setItem(ROLE_KEY, JSON.stringify({ role, t: Date.now() }));
  } catch {}
}

function readCachedRole() {
  try {
    const raw = localStorage.getItem(ROLE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj?.t) return null;
    if (Date.now() - obj.t > ROLE_TTL) return null;
    return obj.role || null;
  } catch {
    return null;
  }
}

/* -------------------- Auth + role init -------------------- */
async function initAuthAndRole() {
  const client = window.supabaseClient;

  // If Supabase not ready, fall back to cache
  if (!client) {
    console.warn('Supabase client not found.');
    const cached = readCachedRole();
    if (cached !== null) setAdminVisible(cached === 'admin');
    return;
  }

  // Apply cached role immediately (prevents flicker)
  const cached = readCachedRole();
  if (cached) setAdminVisible(cached === 'admin');

  try {
    const { data: { session } } = await client.auth.getSession();
    const profileLink =
      document.querySelector('[aria-label="User Profile"]')?.parentElement;

    // Not logged in
    if (!session) {
      if (profileLink) profileLink.setAttribute('href', 'signin.html');
      setAdminVisible(false);
      cacheRole('user');
      return;
    }

    // Logged in
    if (profileLink) {
      profileLink.setAttribute('href', 'profile.html');
      profileLink.title = session.user.email;
    }

    const { data: profile, error } = await client
      .from('profiles')
      .select('role')
      .eq('user_id', session.user.id)
      .single();

    if (error) {
      console.error('Failed to load role:', error);
      if (!cached) setAdminVisible(false);
      return;
    }

    const role = profile?.role || 'user';
    setAdminVisible(role === 'admin');
    cacheRole(role);

  } catch (err) {
    console.error('Auth init failed:', err);
  }
}

/* -------------------- 🔥 AUTH STATE LISTENER (FIX) -------------------- */
function bindAuthListener() {
  const client = window.supabaseClient;
  if (!client) return;

  // Prevent multiple bindings across pages
  if (window.__ysAuthListenerBound) return;
  window.__ysAuthListenerBound = true;

  client.auth.onAuthStateChange(async (event) => {
    console.log('[Auth change]', event);

    if (event === 'SIGNED_OUT') {
      setAdminVisible(false);
      cacheRole('user');
      return;
    }

    // SIGNED_IN, TOKEN_REFRESHED, USER_UPDATED
    await initAuthAndRole();
  });
}

/* -------------------- Small UI wiring -------------------- */
function initSmallUI() {
  // Mobile menu
  const menuBtn = document.getElementById('menuBtn');
  const mobileMenu = document.getElementById('mobileMenu');
  if (menuBtn && mobileMenu) {
    const newBtn = menuBtn.cloneNode(true);
    menuBtn.parentNode.replaceChild(newBtn, menuBtn);
    newBtn.addEventListener('click', () => {
      mobileMenu.classList.toggle('hidden');
      mobileMenu.classList.toggle('-translate-y-full');
    });
  }

  // Navbar shadow
  const navbar = document.getElementById('navbar');
  if (navbar && !navbar._shadowBound) {
    window.addEventListener('scroll', () => {
      navbar.classList.toggle('shadow-md', window.scrollY > 10);
    });
    navbar._shadowBound = true;
  }

  // Dropdown
  const dropdownButton = document.querySelector('.group');
  const dropdownMenu = dropdownButton?.querySelector('div');
  if (dropdownButton && dropdownMenu && !dropdownButton._dropdownBound) {
    const show = () => {
      dropdownMenu.classList.remove('opacity-0', 'visibility-hidden', 'pointer-events-none');
      dropdownMenu.classList.add('opacity-100', 'visibility-visible', 'pointer-events-auto');
    };
    const hide = () => {
      dropdownMenu.classList.remove('opacity-100', 'visibility-visible', 'pointer-events-auto');
      dropdownMenu.classList.add('opacity-0', 'visibility-hidden', 'pointer-events-none');
    };

    dropdownButton.addEventListener('mouseenter', show);
    dropdownButton.addEventListener('mouseleave', () =>
      setTimeout(() => !dropdownMenu.matches(':hover') && hide(), 100)
    );
    dropdownMenu.addEventListener('mouseenter', show);
    dropdownMenu.addEventListener('mouseleave', hide);

    dropdownButton._dropdownBound = true;
  }
}

/* -------------------- Navbar loader -------------------- */
async function tryFetchNavbar(paths = ['./navbar.html', '/navbar.html', 'navbar.html']) {
  for (const p of paths) {
    try {
      const resp = await fetch(p, { cache: 'no-store' });
      if (resp.ok) return await resp.text();
    } catch {}
  }
  return null;
}

async function startNavbar() {
  const existing = document.getElementById('navbar');

  if (existing && existing.children.length > 0) {
    initSmallUI();
    await initAuthAndRole();
    bindAuthListener(); // ✅ FIX APPLIED
    document.dispatchEvent(new CustomEvent('navbar:ready'));
    return;
  }

  const root = document.getElementById('navbar-root');
  if (root) {
    const html = await tryFetchNavbar();
    if (html) {
      root.innerHTML = html;
      await Promise.resolve();
      initSmallUI();
      await initAuthAndRole();
      bindAuthListener(); // ✅ FIX APPLIED
      document.dispatchEvent(new CustomEvent('navbar:ready'));
      return;
    }
  }

  initSmallUI();
  await initAuthAndRole();
  bindAuthListener(); // ✅ FIX APPLIED
  document.dispatchEvent(new CustomEvent('navbar:ready'));
}

document.addEventListener('DOMContentLoaded', startNavbar);
