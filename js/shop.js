// js/shop.js (safe replacement)
// - Reuses/creates a single global Supabase client (window.supabaseClient).
// - Loads products immediately.
// - Defers navbar-dependent features until navbar exists (supports 'navbar:ready' event).

// --- Ensure global keys (do not redeclare with const) ---
window.SUPABASE_URL = window.SUPABASE_URL || 'https://clhzzjugjttqidiuolrj.supabase.co';
window.SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || 'sb_publishable_X8iVVZsZGbS9h_EKCds1wg_02UyKnpS';

// --- Create or reuse a single supabase client ---
window.supabaseClient = window.supabaseClient || (typeof supabase !== 'undefined'
  ? supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY)
  : null);

if (!window.supabaseClient) {
  console.error('Supabase client not available. Did you include the Supabase script before shop.js?');
}

// local reference
const client = window.supabaseClient;

// --- DOM refs ---
let allProducts = [];
let currentCategory = 'All';
let currentSearch = '';
let currentSort = '';

const urlParams = new URLSearchParams(window.location.search);
const selectedCategoryFromURL = urlParams.get('category');

const productGrid = document.getElementById('product-grid');
if (!productGrid) {
  console.error('product-grid element not found.');
}

// --- Load products immediately ---
async function loadProducts() {
  if (!client) {
    productGrid && (productGrid.innerHTML = `<p class="text-red-500">Supabase not initialized.</p>`);
    return;
  }

  try {
    const { data, error } = await client.from('products').select('*');

    if (error) {
      console.error('Error fetching products:', error);
      productGrid && (productGrid.innerHTML = `<p class="text-red-500">Failed to load products.</p>`);
      return;
    }

    if (!data || data.length === 0) {
      productGrid && (productGrid.innerHTML = '<p class="text-gray-600">No products found.</p>');
      return;
    }

    allProducts = data;
    if (selectedCategoryFromURL) {
    currentCategory = selectedCategoryFromURL;
    highlightSidebarCategory(selectedCategoryFromURL);
  }
  applyFilters();

  } catch (err) {
    console.error('loadProducts error:', err);
    productGrid && (productGrid.innerHTML = `<p class="text-red-500">Failed to load products.</p>`);
  }
}

loadProducts();

function applyFilters() {
  let filtered = [...allProducts];

  // Category filter
  if (currentCategory !== 'All') {
    filtered = filtered.filter(p =>
      p.category &&
      p.category.toLowerCase() === currentCategory.toLowerCase()
    );
  }

  // Search filter
  if (currentSearch) {
    filtered = filtered.filter(p =>
      p.name.toLowerCase().includes(currentSearch)
    );
  }

  // Sorting
  if (currentSort === 'price-asc') {
    filtered.sort((a, b) => Number(a.price) - Number(b.price));
  } else if (currentSort === 'price-desc') {
    filtered.sort((a, b) => Number(b.price) - Number(a.price));
  }

  renderProducts(filtered);
}

function renderProducts(products) {
  productGrid.innerHTML = products.map(p => `
    <div class="group bg-white rounded-3xl shadow-md hover:shadow-2xl transition overflow-hidden h-full flex flex-col">
      <div class="relative h-64 bg-white flex items-center justify-center">
        <img src="${p.image_url}" alt="${p.name}" class="h-44 object-contain group-hover:scale-110 transition duration-500">
        <span class="absolute top-4 right-4 bg-orange-500 text-white text-s font-semibold px-3 py-1 rounded-md shadow">
          ${p.category || 'Tools'}
        </span>
      </div>

      <div class="p-6 text-left flex flex-col flex-grow border-t border-gray-150 bg-gray-100/40">
        <h3 class="font-bold text-lg mb-1 text-orange-600 line-clamp-2 min-h-[2rem]">
          ${p.name}
        </h3>

        <div class="flex items-center gap-1 text-yellow-400 text-sm mb-2">
          <i class="bx bxs-star"></i><i class="bx bxs-star"></i>
          <i class="bx bxs-star"></i><i class="bx bxs-star"></i>
          <i class="bx bx-star"></i>
          <span class="text-gray-400 text-xs ml-2">(4.9)</span>
        </div>

        <div class="flex items-center justify-between mt-auto">
          <span class="text-2xl font-bold text-slate-900">
            RM ${Number(p.price).toFixed(2)}
          </span>
          <button class="w-12 h-12 rounded-full bg-slate-200 flex items-center justify-center hover:bg-orange-500 hover:text-white transition active:scale-95">
            <i class="bx bx-cart text-xl"></i>
          </button>
        </div>
      </div>
    </div>
  `).join('');
}

const categoryButtons = document.querySelectorAll('aside button');

categoryButtons.forEach(button => {
button.addEventListener('click', () => {
const selectedCategory = button.textContent.trim();
    currentCategory = selectedCategory;

    categoryButtons.forEach(b =>
      b.classList.remove('bg-orange-50', 'text-orange-600', 'font-semibold')
    );
    button.classList.add('bg-orange-50', 'text-orange-600', 'font-semibold');

    applyFilters();
  });

});

const searchInput = document.getElementById('searchInput');

if (searchInput) {
  searchInput.addEventListener('input', e => {
    currentSearch = e.target.value.toLowerCase();
    applyFilters();
  });
}

const sortSelect = document.getElementById('sortSelect');

if (sortSelect) {
  sortSelect.addEventListener('change', e => {
    currentSort = e.target.value;
    applyFilters();
  });
}

function highlightSidebarCategory(category) {
  const buttons = document.querySelectorAll('aside button');

  buttons.forEach(btn => {
    const text = btn.textContent.trim();

    btn.classList.remove('bg-orange-50', 'text-orange-600', 'font-semibold');

    if (text.toLowerCase() === category.toLowerCase()) {
      btn.classList.add('bg-orange-50', 'text-orange-600', 'font-semibold');
    }
  });
}


// --- NAVBAR-DEPENDENT FEATURES (defensive) ---
function initNavbarDependentFeatures() {
  if (window.__navbar_initialized_for_shop) return;
  window.__navbar_initialized_for_shop = true;

  // Profile link (guarded)
  const profileIcon = document.querySelector('#navbar .bx-user');
  const profileLink = profileIcon ? profileIcon.parentElement : null;

  (async () => {
    try {
      if (!client) return;
      const { data: { session } } = await client.auth.getSession();
      if (!session) {
        if (profileLink) profileLink.setAttribute('href', 'signin.html');
      } else {
        if (profileLink) {
          profileLink.setAttribute('href', 'profile.html');
          profileLink.title = session.user.email;
        }
        const { data: profile, error } = await client.from('profiles').select('role').eq('user_id', session.user.id).single();
        if (!error && profile?.role === 'admin') {
          document.getElementById('adminMenu')?.classList.remove('hidden');
          document.getElementById('adminMenuMobile')?.classList.remove('hidden');
        }
      }
    } catch (err) {
      console.error('Auth check failed:', err);
    }
  })();

  // Navbar interactions (guarded)
  const navbar = document.getElementById('navbar');
  const menuBtn = document.getElementById('menuBtn');
  const mobileMenu = document.getElementById('mobileMenu');

  if (navbar) {
    window.addEventListener('scroll', () => navbar.classList.toggle('shadow-md', window.scrollY > 10));
  }

  if (menuBtn && mobileMenu) {
    // replace node to clear old listeners (defensive)
    try {
      const newMenuBtn = menuBtn.cloneNode(true);
      menuBtn.parentNode.replaceChild(newMenuBtn, menuBtn);
      newMenuBtn.addEventListener('click', () => {
        mobileMenu.classList.toggle('hidden');
        mobileMenu.classList.toggle('-translate-y-full');
      });
    } catch (e) { /* ignore */ }
  }

  // Dropdown wiring (guarded)
  const dropdownButton = document.querySelector('.group');
  const dropdownMenu = dropdownButton ? dropdownButton.querySelector('div') : null;
  if (dropdownButton && dropdownMenu) {
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
  }

  // Active link highlight (guarded)
  const sections = document.querySelectorAll('section');
  const navLinks = document.querySelectorAll('.nav-link');
  if (sections.length && navLinks.length) {
    window.addEventListener('scroll', () => {
      let current = '';
      sections.forEach(section => {
        if (scrollY >= section.offsetTop - 120) current = section.getAttribute('id');
      });
      navLinks.forEach(link => {
        link.classList.remove('text-orange-600', 'font-semibold');
        if (link.getAttribute('href') === `#${current}`) link.classList.add('text-orange-600', 'font-semibold');
      });
    });
  }
}

// If navbar already exists, init navbar-dependent features
if (document.getElementById('navbar')) {
  initNavbarDependentFeatures();
}

// Otherwise wait for navbar to be inserted (navbar.js should dispatch 'navbar:ready')
document.addEventListener('navbar:ready', initNavbarDependentFeatures);