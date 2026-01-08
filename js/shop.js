// js/shop.js
// Uses global Supabase client created in supabase.js
// Loads products + filters + cart integration

// --- Supabase client ---
const client = window.supabaseClient;

if (!client) {
  console.error(
    'Supabase client not available. Make sure:\n' +
    '1) Supabase CDN is loaded\n' +
    '2) supabase.js runs BEFORE shop.js'
  );
}

// --- STATE ---
let allProducts = [];
window.allProducts = window.allProducts || allProducts;

let currentCategory = 'All';
let currentSearch = '';
let currentSort = '';

const urlParams = new URLSearchParams(window.location.search);
const selectedCategoryFromURL = urlParams.get('category');

const productGrid = document.getElementById('product-grid');

// Only run product-grid related code if it exists
if (productGrid) {

  // --- Load products immediately ---
  async function loadProducts() {
    if (!client) {
      productGrid.innerHTML = `<p class="text-red-500">Supabase not initialized.</p>`;
      return;
    }

    try {
      const { data, error } = await client.from('products').select('*');

      if (error) {
        console.error('Error fetching products:', error);
        productGrid.innerHTML = `<p class="text-red-500">Failed to load products.</p>`;
        return;
      }

      if (!data || data.length === 0) {
        productGrid.innerHTML = '<p class="text-gray-600">No products found.</p>';
        return;
      }

      allProducts = data;
      window.allProducts = allProducts;

      if (selectedCategoryFromURL) {
        currentCategory = selectedCategoryFromURL;
        highlightSidebarCategory(selectedCategoryFromURL);
      }

      applyFilters();

    } catch (err) {
      console.error('loadProducts error:', err);
      productGrid.innerHTML = `<p class="text-red-500">Failed to load products.</p>`;
    }
  }

  loadProducts();

  // Attach add-to-cart click delegation
  productGrid.addEventListener('click', handleAddToCartButtonClick);
}


// ---------------- FILTERING ----------------
function applyFilters() {
  let filtered = [...allProducts];

  if (currentCategory !== 'All') {
    filtered = filtered.filter(p =>
      p.category &&
      p.category.toLowerCase() === currentCategory.toLowerCase()
    );
  }

  if (currentSearch) {
    filtered = filtered.filter(p =>
      p.name.toLowerCase().includes(currentSearch)
    );
  }

  if (currentSort === 'price-asc') {
    filtered.sort((a, b) => Number(a.price) - Number(b.price));
  } else if (currentSort === 'price-desc') {
    filtered.sort((a, b) => Number(b.price) - Number(a.price));
  }

  renderProducts(filtered);
}

// ---------------- RENDER ----------------
function renderProducts(products) {
  productGrid.innerHTML = products.map(p => `
    <a href="product-details.html?id=${p.id}" class="group block bg-white rounded-3xl shadow-md hover:shadow-2xl transition overflow-hidden h-full flex flex-col">
      <div class="relative h-64 bg-white flex items-center justify-center">
        <img src="${escapeHtml(p.image_url)}" alt="${escapeHtml(p.name)}" class="h-44 object-contain group-hover:scale-110 transition duration-500">
        <span class="absolute top-4 right-4 bg-orange-500 text-white text-s font-semibold px-3 py-1 rounded-md shadow">
          ${escapeHtml(p.category || 'Tools')}
        </span>
      </div>

      <div class="p-6 text-left flex flex-col flex-grow border-t border-gray-150 bg-gray-100/40">
        <h3 class="font-bold text-lg mb-1 text-orange-600 line-clamp-2 min-h-[2rem]">
          ${escapeHtml(p.name)}
        </h3>

        <div class="flex items-center gap-1 text-yellow-400 text-sm mb-2">
          <i class="bx bxs-star"></i><i class="bx bxs-star"></i>
          <i class="bx bxs-star"></i><i class="bx bxs-star"></i>
          <i class="bx bxs-star"></i>
          <span class="text-gray-400 text-xs ml-2">(5.0)</span>
        </div>

        <div class="flex items-center justify-between mt-auto">
          <span class="text-2xl font-bold text-slate-900">
            RM ${Number(p.price).toFixed(2)}
          </span>

          <button
            class="w-12 h-12 rounded-full flex items-center justify-center transition active:scale-95 add-to-cart-btn
              ${p.stock <= 0 
              ? 'bg-gray-300 text-gray-400 cursor-not-allowed'
              : 'bg-slate-200 hover:bg-orange-500 hover:text-white'}"
              ${p.stock <= 0 ? 'disabled' : ''}
              data-product-id="${escapeHtml(p.id)}"
              data-name="${escapeHtml(p.name)}"
              data-price="${Number(p.price).toFixed(2)}"
              data-image="${escapeHtml(p.image_url)}">
            <i class="bx bx-cart text-xl"></i>
          </button>
        </div>
      </div>
    </a>
  `).join('');
}

// escape helper
function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/[&<>"']/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[m]);
}

// ---------------- CATEGORY ----------------
const categoryButtons = document.querySelectorAll('aside button');

categoryButtons.forEach(button => {
  button.addEventListener('click', () => {
    currentCategory = button.textContent.trim();

    categoryButtons.forEach(b =>
      b.classList.remove('bg-orange-50', 'text-orange-600', 'font-semibold')
    );

    button.classList.add('bg-orange-50', 'text-orange-600', 'font-semibold');
    applyFilters();
  });
});

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

// ---------------- SEARCH ----------------
const searchInput = document.getElementById('searchInput');

if (searchInput) {
  searchInput.addEventListener('input', e => {
    currentSearch = e.target.value.toLowerCase();
    applyFilters();
  });
}

// ---------------- SORT ----------------
const sortSelect = document.getElementById('sortSelect');

if (sortSelect) {
  sortSelect.addEventListener('change', e => {
    currentSort = e.target.value;
    applyFilters();
  });
}

// ---------------- ADD TO CART ----------------
function handleAddToCartButtonClick(e) {
  const btn = e.target.closest('.add-to-cart-btn');
  if (!btn) return;
  e.preventDefault();

  const id = btn.getAttribute('data-product-id');
  if (!id) return;

  const product = (window.allProducts || []).find(p => String(p.id) === String(id));
    if (product && Number(product.stock) <= 0) {
      alert('Sorry, this product is out of stock.');
    return;
    }

  const payload = product || {
    id,
    name: btn.getAttribute('data-name'),
    price: parseFloat(btn.getAttribute('data-price')) || 0,
    image_url: btn.getAttribute('data-image') || ''
  };

  try {
    if (window.cartAPI?.add) {
      window.cartAPI.add(payload);
    } else {
      const KEY = 'ys_cart_v1';
      let store = {};
      try { store = JSON.parse(localStorage.getItem(KEY)) || {}; }
      catch { store = {}; }

      const key = String(payload.id);
      if (store[key]) store[key].qty = (store[key].qty || 0) + 1;
      else store[key] = { ...payload, qty: 1 };

      localStorage.setItem(KEY, JSON.stringify(store));
    }
  } catch (err) {
    console.error('Failed to add to cart', err);
  }
}

productGrid?.addEventListener('click', handleAddToCartButtonClick);
