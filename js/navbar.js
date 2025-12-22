// navbar.js - safe initializer that reuses a singleton Supabase client (window.supabaseClient).
// Include the Supabase library and supabase.js (which creates window.supabaseClient) BEFORE this file.
//
// Responsibilities:
// - If a static <nav id="navbar"> is already present, just wire UI + auth.
// - Otherwise try to fetch ./navbar.html and inject into <div id="navbar-root">, then wire.
// - Avoid creating multiple Supabase clients; use window.supabaseClient.
// - Dispatch a 'navbar:ready' CustomEvent after navbar is initialized so other scripts can listen.

const ROLE_KEY = 'ys_role_v1';
const ROLE_TTL = 1000 * 60 * 5;

function setAdminVisible(isAdmin) {
  const desktop = document.getElementById('adminMenu');
  const mobile = document.getElementById('adminMenuMobile');
  if (desktop) {
    desktop.classList.toggle('hidden', !isAdmin);
  }
  if (mobile) {
    mobile.classList.toggle('hidden', !isAdmin);
  }
}

function cacheRole(role) {
  try { localStorage.setItem(ROLE_KEY, JSON.stringify({ role, t: Date.now() })); } catch (e) {}
}
function readCachedRole() {
  try {
    const raw = localStorage.getItem(ROLE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || !obj.t) return null;
    if (Date.now() - obj.t > ROLE_TTL) return null;
    return obj.role || null;
  } catch (e) { return null; }
}

async function initAuthAndRole() {
  const client = window.supabaseClient;
  if (!client) {
    console.warn('Supabase client not found (window.supabaseClient). Auth/role check skipped.');
    // still dispatch cached state if available
    const cached = readCachedRole();
    if (cached !== null) setAdminVisible(cached === 'admin');
    return;
  }

  // apply cached role immediately to reduce flicker
  const cached = readCachedRole();
  if (cached) setAdminVisible(cached === 'admin');

  try {
    const { data: { session } } = await client.auth.getSession();
    const profileLink = document.querySelector('[aria-label="User Profile"]')?.parentElement;

    if (!session) {
      if (profileLink) profileLink.setAttribute('href', 'signin.html');
      setAdminVisible(false);
      cacheRole('user');
      return;
    }

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

function initSmallUI() {
  // Menu button & mobile menu
  const menuBtn = document.getElementById('menuBtn');
  const mobileMenu = document.getElementById('mobileMenu');
  if (menuBtn && mobileMenu) {
    // replace to remove previously attached listeners safely
    const newBtn = menuBtn.cloneNode(true);
    menuBtn.parentNode.replaceChild(newBtn, menuBtn);
    newBtn.addEventListener('click', () => {
      mobileMenu.classList.toggle('hidden');
      mobileMenu.classList.toggle('-translate-y-full');
    });
  }

  // Navbar shadow on scroll
  const navbar = document.getElementById('navbar');
  if (navbar) {
    // avoid duplicate listener by checking a flag
    if (!navbar._shadowBound) {
      window.addEventListener('scroll', () => {
        navbar.classList.toggle('shadow-md', window.scrollY > 10);
      });
      navbar._shadowBound = true;
    }
  }

  // Dropdown wiring (defensive)
  const dropdownButton = document.querySelector('.group');
  const dropdownMenu = dropdownButton ? dropdownButton.querySelector('div') : null;
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
    dropdownButton.addEventListener('mouseleave', () => setTimeout(() => !dropdownMenu.matches(':hover') && hide(), 100));
    dropdownMenu.addEventListener('mouseenter', show);
    dropdownMenu.addEventListener('mouseleave', hide);

    dropdownButton._dropdownBound = true;
  }

  // Active link highlight (only if there are nav-links)
  const sections = document.querySelectorAll('section');
  if (sections.length) {
    // guard duplicate binding
    if (!initSmallUI._activeBound) {
      window.addEventListener('scroll', () => {
        let current = '';
        sections.forEach(section => {
          const sectionTop = section.offsetTop - 120;
          if (window.scrollY >= sectionTop) current = section.getAttribute('id');
        });
        const navLinks = document.querySelectorAll('.nav-link');
        navLinks.forEach(link => {
          link.classList.remove('text-orange-600', 'font-semibold');
          if (link.getAttribute('href') === `#${current}`) {
            link.classList.add('text-orange-600', 'font-semibold');
          }
        });
      });
      initSmallUI._activeBound = true;
    }
  }
}

// Try multiple candidate paths for navbar.html
async function tryFetchNavbar(paths = ['./navbar.html', '/navbar.html', 'navbar.html']) {
  for (const p of paths) {
    try {
      const resp = await fetch(p, { cache: 'no-store' });
      if (resp.ok) {
        console.log('Loaded navbar partial from', p);
        return await resp.text();
      } else {
        console.warn('Navbar fetch returned', resp.status, 'for', p);
      }
    } catch (err) {
      // fetch can fail on file:// or bad path; continue trying
      console.warn('Navbar fetch error for', p, err);
    }
  }
  return null;
}

async function startNavbar() {
  const existing = document.getElementById('navbar');
  if (existing && existing.children.length > 0) {
    // static navbar already in page
    initSmallUI();
    await initAuthAndRole();
    // notify other scripts
    document.dispatchEvent(new CustomEvent('navbar:ready'));
    return;
  }

  // attempt to fetch and inject partial
  const root = document.getElementById('navbar-root');
  if (root) {
    const html = await tryFetchNavbar();
    if (html) {
      root.innerHTML = html;
      // small delay to ensure DOM inserted (useful if other scripts run immediately)
      await Promise.resolve();
      initSmallUI();
      await initAuthAndRole();
      document.dispatchEvent(new CustomEvent('navbar:ready'));
      return;
    }
  }

  // fallback: nothing to inject; still initialize UI/auth in case navbar exists or was injected by other means
  initSmallUI();
  await initAuthAndRole();
  document.dispatchEvent(new CustomEvent('navbar:ready'));
}

document.addEventListener('DOMContentLoaded', startNavbar);