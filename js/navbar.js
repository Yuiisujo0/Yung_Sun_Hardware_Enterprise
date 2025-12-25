const ROLE_KEY = 'ys_role_v1';
const ROLE_TTL = 1000 * 60 * 5;

/* -------------------- Welcome User -------------------- */
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

/* -------------------- Logout Button -------------------- */
function showLogoutBtn() {
  const btn = document.getElementById('logoutBtn');
  if (btn) btn.classList.remove('hidden');
}

function hideLogoutBtn() {
  const btn = document.getElementById('logoutBtn');
  if (btn) btn.classList.add('hidden');
}

function bindLogout() {
  const btn = document.getElementById('logoutBtn');
  if (!btn || btn._bound) return;

  btn.addEventListener('click', async () => {
    const client = window.supabaseClient;
    if (!client) return;

    try {
      await client.auth.signOut();
      hideLogoutBtn();
      hideWelcomeUser();
      setAdminVisible(false);
      cacheRole('user');
      window.location.href = 'index.html';
    } catch (err) {
      console.error('Logout failed:', err);
    }
  });

  btn._bound = true;
}

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

  if (!client) {
    console.warn('Supabase client not found.');
    const cached = readCachedRole();
    if (cached !== null) setAdminVisible(cached === 'admin');
    return;
  }

  const cached = readCachedRole();
  if (cached) setAdminVisible(cached === 'admin');

  try {
    const { data: { session } } = await client.auth.getSession();
    const profileLink =
      document.querySelector('[aria-label="User Profile"]')?.parentElement;

    if (!session) {
      if (profileLink) profileLink.setAttribute('href', 'signin.html');
      setAdminVisible(false);
      hideWelcomeUser();
      hideLogoutBtn();
      cacheRole('user');
      return;
    }

    if (profileLink) {
      profileLink.setAttribute('href', 'profile.html');
      profileLink.title = session.user.email;
    }

    // Load profile (full_name + role)
    const { data: profile, error } = await client
      .from('profiles')
      .select('role, full_name')
      .eq('user_id', session.user.id)
      .single();

    if (error) {
      console.error('Failed to load profile:', error);
    } else {
      const displayName =
        profile?.full_name ||
        session.user.user_metadata?.full_name ||
        session.user.email?.split('@')[0] ||
        'User';

      setWelcomeUser(displayName);
      showLogoutBtn();

      const role = profile?.role || 'user';
      setAdminVisible(role === 'admin');
      cacheRole(role);
    }
  } catch (err) {
    console.error('Auth init failed:', err);
  }
}

/* -------------------- 🔥 AUTH STATE LISTENER -------------------- */
function bindAuthListener() {
  const client = window.supabaseClient;
  if (!client) return;
  if (window.__ysAuthListenerBound) return;
  window.__ysAuthListenerBound = true;

  client.auth.onAuthStateChange(async (event) => {
    console.log('[Auth change]', event);

    if (event === 'SIGNED_OUT') {
      setAdminVisible(false);
      hideWelcomeUser();
      hideLogoutBtn();
      cacheRole('user');
      return;
    }

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

  // Dropdown menu
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
    bindAuthListener();
    bindLogout();
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
      bindAuthListener();
      bindLogout();
      document.dispatchEvent(new CustomEvent('navbar:ready'));
      return;
    }
  }

  initSmallUI();
  await initAuthAndRole();
  bindAuthListener();
  bindLogout();
  document.dispatchEvent(new CustomEvent('navbar:ready'));
}

document.addEventListener('DOMContentLoaded', startNavbar);
