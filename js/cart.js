// js/cart.js
// Simple site-wide cart module (works on pages with or without existing drawer markup).
// - Injects drawer markup if not present.
// - Persists cart in localStorage under key 'ys_cart_v1' by default.
// - Supports per-user cart keys 'ys_cart_v1_user_<userId>' and provides migrateAnonymousToUser(userId).
// - Exposes window.cartAPI: { add(product), open(), close(), getItems(), count(), clear(), migrateAnonymousToUser(userId) }.
// - Exposes window.cartAPIReady Promise that resolves when cart module initialization completes.
// - Listens for navbar ready and wires navbar cart icons to open drawer.
// - Responds to 'cart:changed' events by reloading cart state from storage.

(function () {
  const STORAGE_KEY = 'ys_cart_v1';

  // Provide a ready promise other scripts can await
  let _cartReadyResolve;
  window.cartAPIReady = new Promise((resolve) => { _cartReadyResolve = resolve; });

  // Utility
  function qs(sel, el = document) { return el.querySelector(sel); }
  function qsa(sel, el = document) { return Array.from((el || document).querySelectorAll(sel)); }
  function formatRM(n) { return `RM${Number(n || 0).toFixed(2)}`; }

  // CART state
  // internal variable storing which localStorage key we currently read/write
  let currentStorageKey = STORAGE_KEY;
  let cart = {}; // { id: { id, name, price, image_url, qty } }

  // Load: attempt to use currentStorageKey, otherwise fall back:
  // - try anonymous STORAGE_KEY
  // - if missing, look for a single user-scoped key that starts with STORAGE_KEY + '_user_'
  function load() {
    try {
      // Prefer the currentStorageKey if it exists in localStorage
      let keyToUse = currentStorageKey || STORAGE_KEY;
      let raw = localStorage.getItem(keyToUse);

      if (!raw) {
        // If the preferred key is empty/missing, try anonymous key
        raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          keyToUse = STORAGE_KEY;
        } else {
          // Try to find any user-scoped key (e.g. 'ys_cart_v1_user_<id>')
          const keys = Object.keys(localStorage).filter(k => k.startsWith(`${STORAGE_KEY}_user_`));
          if (keys.length === 1) {
            keyToUse = keys[0];
            raw = localStorage.getItem(keyToUse);
          } else if (keys.length > 1) {
            // If multiple user keys exist (unlikely in one browser), prefer currentStorageKey if set,
            // otherwise pick the one with most items as best-effort
            let best = keys[0];
            let bestCount = (JSON.parse(localStorage.getItem(best) || '{}') && Object.keys(JSON.parse(localStorage.getItem(best) || '{}')).length) || 0;
            for (let i = 1; i < keys.length; i++) {
              const k = keys[i];
              const cnt = (JSON.parse(localStorage.getItem(k) || '{}') && Object.keys(JSON.parse(localStorage.getItem(k) || '{}')).length) || 0;
              if (cnt > bestCount) { best = k; bestCount = cnt; }
            }
            keyToUse = best;
            raw = localStorage.getItem(keyToUse);
          }
        }
      }

      currentStorageKey = keyToUse || STORAGE_KEY;
      cart = raw ? JSON.parse(raw) : {};
    } catch (e) {
      console.error('cart load error', e);
      cart = {};
      currentStorageKey = STORAGE_KEY;
    }
  }
  function save() {
    try { localStorage.setItem(currentStorageKey || STORAGE_KEY, JSON.stringify(cart)); } catch (e) { console.error('cart save', e); }
  }
  function itemsArray() { return Object.values(cart); }
  function subtotal() { return itemsArray().reduce((s, it) => s + (Number(it.price || 0) * (it.qty || 0)), 0); }
  function totalCount() { return itemsArray().reduce((s, it) => s + (it.qty || 0), 0); }

  // Drawer markup (use only if page doesn't already have one)
  const drawerHTML = `
  <div id="cart-overlay" class="fixed inset-0 bg-black bg-opacity-0 pointer-events-none transition-opacity duration-300 z-40"></div>

  <aside id="cart-drawer" aria-label="Cart" class="fixed right-0 top-0 h-full w-96 max-w-full transform translate-x-full bg-white shadow-xl transition-transform duration-300 z-50 flex flex-col">
    <div class="p-4 border-b flex items-center justify-between">
      <h2 class="text-lg font-semibold">Cart</h2>
      <button id="cart-close-btn" aria-label="Close cart" class="text-xl">✕</button>
    </div>

    <div id="cart-items" class="p-4 overflow-auto flex-1 flex flex-col divide-y divide-gray-200 space-y-4">
        <!-- Items injected -->
    </div>

    <div class="p-4 border-t">
      <div class="flex justify-between mb-2">
        <span>Sub-Total:</span>
        <span id="cart-subtotal">RM0.00</span>
      </div>
      <button id="checkout-btn" class="w-full bg-orange-600 text-white py-3 rounded font-semibold">CHECKOUT</button>
    </div>
  </aside>
  `;

  function ensureDrawer() {
    if (qs('#cart-drawer')) return; // already present
    document.body.insertAdjacentHTML('beforeend', drawerHTML);
  }

  // Render cart contents into drawer
  function renderDrawer() {
    ensureDrawer();
    const itemsEl = qs('#cart-items');
    const subtotalEl = qs('#cart-subtotal');
    if (!itemsEl || !subtotalEl) return;

    const items = itemsArray();
    if (items.length === 0) {
      itemsEl.innerHTML = `<p class="text-gray-500">Your cart is empty.</p>`;
      subtotalEl.textContent = formatRM(0);
      updateBadge();
      return;
    }

    itemsEl.innerHTML = items.map(it => `
  <div class="cart-item flex items-start gap-3" data-product-id="${it.id}">
    <img src="${it.image_url || ''}" alt="${escapeHtml(it.name)}" class="rounded w-20 h-20 object-contain">
    <div class="flex-1">
      <div class="flex justify-between items-start">
        <div class="text-sm font-semibold">${escapeHtml(it.name)}</div>

        <button
          class="remove-btn p-2 rounded-full hover:bg-red-100 text-red-600 transition cursor-pointer"
          data-action="remove">
          <svg xmlns="http://www.w3.org/2000/svg"
               class="w-5 h-5"
               fill="none"
               viewBox="0 0 24 24"
               stroke="currentColor"
               stroke-width="2">
            <path stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7h6m2 0H7m5-3v3"/>
          </svg>
        </button>

      </div>
      <div class="text-lg font-bold text-orange-600 mt-1">${formatRM(Number(it.price || 0))}</div>
      <div class="mt-3 flex items-center gap-2">
        <button class="qty-btn w-8 h-8 flex items-center justify-center border" data-action="decrease">-</button>
        <input type="text" inputmode="numeric" class="qty-input text-center border rounded px-1" value="${it.qty}" style="width:48px;">
        <button class="qty-btn w-8 h-8 flex items-center justify-center border" data-action="increase">+</button>
      </div>
    </div>
  </div>
`).join('');

    subtotalEl.textContent = formatRM(subtotal());
    updateBadge();
  }

  // Simple HTML escape
  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, (m) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[m]);
  }

  // Drawer controls
  function open() {
    ensureDrawer();
    const drawer = qs('#cart-drawer');
    const overlay = qs('#cart-overlay');
    if (!drawer || !overlay) return;
    drawer.classList.remove('translate-x-full');
    drawer.classList.add('translate-x-0');
    overlay.classList.add('pointer-events-auto');
    overlay.classList.remove('bg-opacity-0');
    overlay.classList.add('bg-opacity-50');
  }
  function close() {
    const drawer = qs('#cart-drawer');
    const overlay = qs('#cart-overlay');
    if (!drawer || !overlay) return;
    drawer.classList.remove('translate-x-0');
    drawer.classList.add('translate-x-full');
    overlay.classList.remove('pointer-events-auto');
    overlay.classList.remove('bg-opacity-50');
    overlay.classList.add('bg-opacity-0');
  }

  // Cart operations
  function add(product) {
    if (!product) return;
    const id = String(product.id || product);
    const quantityToAdd = Number(product.qty) || 1; // use qty if provided
    const existing = cart[id];

    if (existing) {
      existing.qty += quantityToAdd;
    } else {
      cart[id] = {
        id,
        name: product.name || product.title || `Item ${id}`,
        price: Number(product.price || 0),
        image_url: product.image_url || product.image || '',
        qty: quantityToAdd
     };
    }

    save();
    renderDrawer();
    open();
  }

  function setQty(id, qty) {
    id = String(id);
    if (!cart[id]) return;
    const q = Math.max(0, Number(qty) || 0);
    if (q <= 0) delete cart[id];
    else cart[id].qty = q;
    save();
    renderDrawer();
  }
  function remove(id) {
    id = String(id);
    if (cart[id]) delete cart[id];
    save();
    renderDrawer();
  }
  function clear() { cart = {}; save(); renderDrawer(); }

  // Update small badge near navbar cart icons (creates badge if none)
  function updateBadge() {
    const count = totalCount();
    // look for all cart icons inside #navbar
    const navIcons = qsa('#navbar .bx-cart');
    navIcons.forEach(icon => {
      let badge = icon.parentElement?.querySelector('.cart-badge') || icon.querySelector('.cart-badge');
      if (!badge) {
        // create a small badge span
        badge = document.createElement('span');
        badge.className = 'cart-badge inline-flex items-center justify-center text-xs text-white bg-red-600 rounded-full w-5 h-5 text-[11px] ml-1';
        badge.style.minWidth = '20px';
        // try to append intelligently
        if (icon.tagName.toLowerCase() === 'i') {
          icon.insertAdjacentElement('afterend', badge);
        } else {
          icon.appendChild(badge);
        }
      }
      badge.textContent = count > 0 ? String(count) : '';
      badge.style.display = count > 0 ? 'inline-flex' : 'none';
    });
  }

  // Wire interactions (delegation)
  function wireDrawerEvents() {
    const itemsEl = qs('#cart-items');
    if (!itemsEl) return;

    // clicks inside cart-items
    itemsEl.removeEventListener('click', cartClickHandler);
    itemsEl.addEventListener('click', cartClickHandler);

    // change qty input
    itemsEl.removeEventListener('change', cartChangeHandler);
    itemsEl.addEventListener('change', cartChangeHandler);

    // overlay and close button
    const overlay = qs('#cart-overlay');
    const closeBtn = qs('#cart-close-btn');
    if (overlay) {
      overlay.removeEventListener('click', close);
      overlay.addEventListener('click', close);
    }
    if (closeBtn) {
      closeBtn.removeEventListener('click', close);
      closeBtn.addEventListener('click', close);
    }

    // checkout (placeholder behavior)
    const checkout = qs('#checkout-btn');
    if (checkout) {
      checkout.removeEventListener('click', checkoutHandler);
      checkout.addEventListener('click', checkoutHandler);
    }
  }

  function cartClickHandler(e) {
    const target = e.target;
    const itemEl = target.closest('[data-product-id]');
    if (!itemEl) return;
    const pid = itemEl.getAttribute('data-product-id');
    if (target.closest('[data-action="remove"]')) {
      remove(pid);
      return;
    }
    if (target.closest('[data-action="increase"]')) {
      setQty(pid, (cart[pid]?.qty || 0) + 1);
      return;
    }
    if (target.closest('[data-action="decrease"]')) {
      setQty(pid, (cart[pid]?.qty || 0) - 1);
      return;
    }
  }
  function cartChangeHandler(e) {
    const input = e.target;
    if (!input.classList.contains('qty-input')) return;
    const itemEl = input.closest('[data-product-id]');
    if (!itemEl) return;
    const pid = itemEl.getAttribute('data-product-id');
    const val = parseInt(input.value, 10);
    if (Number.isNaN(val) || val <= 0) remove(pid);
    else setQty(pid, val);
  }
    function checkoutHandler() {
    const items = itemsArray();
    if (!items.length) {
      alert('Cart is empty.');
      return;
    }
    // Save cart to localStorage (already saved, but ensure we have a consistent key)
    localStorage.setItem('ys_cart_checkout', JSON.stringify(items));

    // Redirect to checkout page
    window.location.href = 'checkout.html';
  }

  // Wire navbar cart icons to open drawer (run when navbar is present)
  function wireNavbarCartIcons() {
    const navIcons = qsa('#navbar .bx-cart');
    if (!navIcons.length) return;
    navIcons.forEach(icon => {
      // attach click
      icon.removeEventListener('click', navIconClickHandler);
      icon.addEventListener('click', navIconClickHandler);
    });
  }
  function navIconClickHandler(e) {
    e.preventDefault();
    open();
  }

  // Public API
  const api = {
    add(product) { add(product); },
    open() { open(); },
    close() { close(); },
    getItems() { return itemsArray(); },
    count() { return totalCount(); },
    clear() { clear(); },
    _render: renderDrawer, // exposed for debugging

    // Migrate anonymous cart to a user-scoped key and load it into the cart module.
    // Returns true if migration did something, false otherwise.
    async migrateAnonymousToUser(userId) {
      try {
        if (!userId) return false;
        const anonRaw = localStorage.getItem(STORAGE_KEY);
        if (!anonRaw) return false;
        const userKey = `${STORAGE_KEY}_user_${userId}`;
        const anon = JSON.parse(anonRaw || '{}');
        const existingRaw = localStorage.getItem(userKey);
        if (!existingRaw) {
          localStorage.setItem(userKey, JSON.stringify(anon));
        } else {
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
        // Remove anonymous key to avoid leakage
        localStorage.removeItem(STORAGE_KEY);

        // Point this cart module to the user key and reload
        currentStorageKey = userKey;
        load();
        save();
        renderDrawer();
        return true;
      } catch (err) {
        console.warn('migrateAnonymousToUser failed', err);
        return false;
      }
    }
  };

  // Initialize on load
  function init() {
    load();
    ensureDrawer();
    // make sure drawer is hidden initially (tailwind classes rely on translate)
    const drawer = qs('#cart-drawer');
    if (drawer) {
      drawer.classList.add('translate-x-full');
      drawer.classList.remove('translate-x-0');
    }
    // wire events
    wireDrawerEvents();
    renderDrawer();

    // respond to navbar:ready
    if (qs('#navbar')) wireNavbarCartIcons();
    document.addEventListener('navbar:ready', () => {
      // small delay to allow navbar DOM settle
      setTimeout(() => {
        wireNavbarCartIcons();
        renderDrawer();
      }, 10);
    });

    // Listen for cart changes triggered externally (e.g. navbar fallback moved keys)
    document.addEventListener('cart:changed', () => {
      // reload from storage (this will discover user-scoped key if anon was moved)
      load();
      renderDrawer();
    });

    // expose API
    window.cartAPI = api;

    // resolve ready promise so other pages can await cart readiness
    try { _cartReadyResolve && _cartReadyResolve(window.cartAPI); } catch (e) {}
  }

  // safe init after DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();