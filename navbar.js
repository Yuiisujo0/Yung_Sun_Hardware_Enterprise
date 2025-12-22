// navbar.js - safe initializer: if #navbar exists, don't fetch - just wire UI & auth
// Make sure Supabase script is included before this script in your pages.

const SUPABASE_URL = 'https://clhzzjugjttqidiuolrj.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_X8iVVZsZGbS9h_EKCds1wg_02UyKnpS';
const ROLE_KEY = 'ys_role_v1';
const ROLE_TTL = 1000 * 60 * 5;

function setAdminVisible(isAdmin) {
  const desktop = document.getElementById('adminMenu');
  const mobile = document.getElementById('adminMenuMobile');
  if (desktop) {
    if (isAdmin) desktop.classList.remove('hidden');
    else desktop.classList.add('hidden');
  }
  if (mobile) {
    if (isAdmin) mobile.classList.remove('hidden');
    else mobile.classList.add('hidden');
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
  if (typeof supabase === 'undefined') {
    console.warn('Supabase not found; auth init skipped.');
    return;
  }
  const client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const cached = readCachedRole();
  if (cached) setAdminVisible(cached === 'admin');

  try {
    const { data: { session } } = await client.auth.getSession();
    const profileLink = document.querySelector('[aria-label="User Profile"]')?.parentElement;

    if (!session) {
      profileLink?.setAttribute('href', 'signin.html');
      setAdminVisible(false);
      cacheRole('user');
      return;
    }

    profileLink?.setAttribute('href', 'profile.html');
    profileLink.title = session.user.email;

    const { data: profile, error } = await client.from('profiles').select('role').eq('user_id', session.user.id).single();
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
  // menu button & mobile menu
  const menuBtn = document.getElementById('menuBtn');
  const mobileMenu = document.getElementById('mobileMenu');
  if (menuBtn && mobileMenu) {
    // remove previous listener (defensive)
    menuBtn.replaceWith(menuBtn.cloneNode(true));
    const newBtn = document.getElementById('menuBtn');
    newBtn.addEventListener('click', () => {
      mobileMenu.classList.toggle('hidden');
      mobileMenu.classList.toggle('-translate-y-full');
    });
  }

  // navbar shadow on scroll
  const navbar = document.getElementById('navbar');
  if (navbar) {
    window.addEventListener('scroll', () => {
      if (window.scrollY > 10) navbar.classList.add('shadow-md');
      else navbar.classList.remove('shadow-md');
    });
  }

  // dropdown wiring (defensive: only if exists)
  const dropdownButton = document.querySelector('.group');
  if (dropdownButton) {
    const dropdownMenu = dropdownButton.querySelector('div');
    if (dropdownMenu) {
      dropdownButton.addEventListener('mouseenter', () => {
        dropdownMenu.classList.add('opacity-100', 'visibility-visible', 'pointer-events-auto');
        dropdownMenu.classList.remove('opacity-0', 'visibility-hidden', 'pointer-events-none');
      });
      dropdownButton.addEventListener('mouseleave', () => {
        setTimeout(() => {
          if (!dropdownMenu.matches(':hover')) {
            dropdownMenu.classList.add('opacity-0', 'visibility-hidden', 'pointer-events-none');
            dropdownMenu.classList.remove('opacity-100', 'visibility-visible', 'pointer-events-auto');
          }
        }, 100);
      });
      dropdownMenu.addEventListener('mouseenter', () => {
        dropdownMenu.classList.add('opacity-100', 'visibility-visible', 'pointer-events-auto');
        dropdownMenu.classList.remove('opacity-0', 'visibility-hidden', 'pointer-events-none');
      });
      dropdownMenu.addEventListener('mouseleave', () => {
        dropdownMenu.classList.add('opacity-0', 'visibility-hidden', 'pointer-events-none');
        dropdownMenu.classList.remove('opacity-100', 'visibility-visible', 'pointer-events-auto');
      });
    }
  }

  // active link highlight (only if nav contains .nav-link)
  const sections = document.querySelectorAll('section');
  if (sections.length) {
    window.addEventListener('scroll', () => {
      let current = '';
      sections.forEach(section => {
        const sectionTop = section.offsetTop - 120;
        if (scrollY >= sectionTop) current = section.getAttribute('id');
      });
      const navLinks = document.querySelectorAll('.nav-link');
      navLinks.forEach(link => {
        link.classList.remove('text-orange-600', 'font-semibold');
        if (link.getAttribute('href') === `#${current}`) {
          link.classList.add('text-orange-600', 'font-semibold');
        }
      });
    });
  }
}

// smart insert / init
async function startNavbar() {
  // If navbar exists already in DOM (static markup), do not fetch/inject — only init.
  const existing = document.getElementById('navbar');
  if (existing && existing.children.length > 0) {
    initSmallUI();
    await initAuthAndRole();
    return;
  }

  // Otherwise try to fetch navbar partial (if you use the partial approach)
  try {
    const resp = await fetch('./navbar.html', { cache: 'no-store' });
    if (resp.ok) {
      const html = await resp.text();
      const root = document.getElementById('navbar-root');
      if (root) root.innerHTML = html;
      initSmallUI();
      await initAuthAndRole();
      return;
    }
  } catch (e) {
    console.warn('navbar partial fetch skipped/failed:', e);
  }

  // If neither existed nor fetch worked, try init in case fallback was injected elsewhere.
  initSmallUI();
  await initAuthAndRole();
}

document.addEventListener('DOMContentLoaded', startNavbar);