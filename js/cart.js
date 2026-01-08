// js/cart.js
// Simple site-wide cart module (works on pages with or without existing drawer markup).
// - Injects drawer markup if not present.
// - Persists cart in localStorage under key 'ys_cart_v1' by default.
// - Supports per-user cart keys 'ys_cart_v1_user_<userId>' and provides migrateAnonymousToUser(userId).
// - Exposes window.cartAPI: { add(product), setQty(id, qty), remove(id), open(), close(), getItems(), count(), clear(), migrateAnonymousToUser(userId), useAnonymousAndClear(), useAnonymous(), setUserKey(userId) }[...]
// - Exposes window.cartAPIReady Promise that resolves when cart module initialization completes.
// - Dispatches 'cart:changed' when the cart changes so other parts of the app (checkout.js, payment.js) can re-render.
// - Exposes window.cartAddFallback(product) for pages/scripts that cannot access cartAPI (race or ordering issues).

(function () {
  // Prevent double-init if this file is loaded more than once
  if (window.__ysCartLoaded) return;
  window.__ysCartLoaded = true;

  const STORAGE_KEY = 'ys_cart_v1';
  const STAGED_CHECKOUT_KEY = 'ys_cart_checkout';

  // Provide a ready promise other scripts can await
  let _cartReadyResolve;
  window.cartAPIReady = new Promise((resolve) => { _cartReadyResolve = resolve; });

  // Utility
  function qs(sel, el = document) { try { return el.querySelector(sel); } catch (e) { return null; } }
  function qsa(sel, el = document) { try { return Array.from((el || document).querySelectorAll(sel)); } catch (e) { return []; } }
  function formatRM(n) { return `RM${Number(n || 0).toFixed(2)}`; }

  // CART state
  let currentStorageKey = STORAGE_KEY;
  let cart = {}; // { id: { id, name, price, image_url, qty } }

  // Emit cart change event and keep staged checkout snapshot up-to-date
  function notifyCartChanged() {
    try {
      try {
        const staged = Object.values(cart).map(i => ({ ...i }));
        localStorage.setItem(STAGED_CHECKOUT_KEY, JSON.stringify(staged));
      } catch (e) { /* ignore */ }
      document.dispatchEvent(new CustomEvent('cart:changed', { detail: { time: Date.now() } }));
    } catch (e) {
      console.warn('notifyCartChanged failed', e);
    }
  }

  // Load current cart from storage (safe, conservative)
  function load() {
    try {
      let keyToUse = currentStorageKey || STORAGE_KEY;
      let raw = localStorage.getItem(keyToUse);

      if (raw) {
        currentStorageKey = keyToUse;
        cart = JSON.parse(raw);
        try { localStorage.setItem(STAGED_CHECKOUT_KEY, JSON.stringify(Object.values(cart))); } catch (e) {}
        return;
      }

      if (keyToUse !== STORAGE_KEY) {
        currentStorageKey = keyToUse;
        cart = {};
        try { localStorage.setItem(STAGED_CHECKOUT_KEY, JSON.stringify([])); } catch (e) {}
        return;
      }

      raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        keyToUse = STORAGE_KEY;
      } else {
        const keys = Object.keys(localStorage).filter(k => k.startsWith(`${STORAGE_KEY}_user_`));
        if (keys.length === 1) {
          keyToUse = keys[0];
          raw = localStorage.getItem(keyToUse);
        }
      }

      currentStorageKey = keyToUse || STORAGE_KEY;
      cart = raw ? JSON.parse(raw) : {};
      try { localStorage.setItem(STAGED_CHECKOUT_KEY, JSON.stringify(Object.values(cart))); } catch (e) {}
    } catch (e) {
      console.error('cart load error', e);
      cart = {};
      currentStorageKey = STORAGE_KEY;
    }
  }

  function save() {
    try {
      localStorage.setItem(currentStorageKey || STORAGE_KEY, JSON.stringify(cart));
      try { localStorage.setItem(STAGED_CHECKOUT_KEY, JSON.stringify(Object.values(cart))); } catch (e) {}
    } catch (e) { console.error('cart save', e); }
  }

  function itemsArray() { return Object.values(cart); }
  function subtotal() { return itemsArray().reduce((s, it) => s + (Number(it.price || 0) * (it.qty || 0)), 0); }
  function totalCount() { return itemsArray().reduce((s, it) => s + (it.qty || 0), 0); }

  // Drawer markup
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

  // Injected automatically
  function ensureDrawer() {
    if (qs('#cart-drawer')) return;
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

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, (m) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[m]);
  }

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
  /*Add items*/
  function add(product) {
  if (!product) return;

  const id = String(product.id || product);
  const quantityToAdd = Number(product.qty) || 1;

  // 🔒 STOCK GUARD (defensive)
  if (typeof product.stock === 'number' && product.stock <= 0) {
    console.warn(`Product ${id} is out of stock. Add blocked.`);
    return;
  }

  const existing = cart[id];
  const existingQty = existing?.qty || 0;

  // 🔒 Prevent exceeding stock
  if (typeof product.stock === 'number') {
    if (existingQty + quantityToAdd > product.stock) {
      console.warn(`Product ${id} exceeds available stock.`);
      return;
    }
  }

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
  notifyCartChanged();
  open();
}


  /*Change quantity*/
  function setQty(id, qty) {
    id = String(id);
    const q = Math.max(0, Number(qty) || 0);
    if (!cart[id] && q > 0) return;
    if (q <= 0) delete cart[id];
    else cart[id].qty = q;
    save();
    renderDrawer();
    notifyCartChanged();
  }

  /*Remove item*/
  function removeItem(id) {
    id = String(id);
    if (cart[id]) delete cart[id];
    save();
    renderDrawer();
    notifyCartChanged();
  }

  /*Clear cart*/
  function clear() { cart = {}; save(); renderDrawer(); notifyCartChanged(); }

  /*Updates cart count*/
  function updateBadge() {
    const count = totalCount();
    const navIcons = qsa('#navbar .bx-cart');
    navIcons.forEach(icon => {
      let badge = icon.parentElement?.querySelector('.cart-badge') || icon.querySelector('.cart-badge');
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'cart-badge inline-flex items-center justify-center text-xs text-white bg-red-600 rounded-full w-5 h-5 text-[11px] ml-1';
        badge.style.minWidth = '20px';
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

  function wireDrawerEvents() {
    const itemsEl = qs('#cart-items');
    if (!itemsEl) return;
    itemsEl.removeEventListener('click', cartClickHandler);
    itemsEl.addEventListener('click', cartClickHandler);
    itemsEl.removeEventListener('change', cartChangeHandler);
    itemsEl.addEventListener('change', cartChangeHandler);

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
      removeItem(pid);
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
    if (Number.isNaN(val) || val <= 0) removeItem(pid);
    else setQty(pid, val);
  }

  /*Checkout Logic*/
  async function checkoutHandler() {
    const items = itemsArray();
    if (!items.length) { alert('Cart is empty.'); return; }

    try { localStorage.setItem(STAGED_CHECKOUT_KEY, JSON.stringify(items)); } catch (e) {}
    let isLoggedIn = false;
    try {
      if (window.supabaseClient) {
        const { data: { session } } = await window.supabaseClient.auth.getSession();
        isLoggedIn = !!session;
      }
    } catch (err) { console.warn('Failed to determine auth session:', err); isLoggedIn = false; }

    if (!isLoggedIn) {
      try { localStorage.setItem('ys_cart_pending_redirect', 'checkout.html'); } catch (e) {}
      window.location.href = 'signin.html?redirect=checkout.html';
      return;
    }
    window.location.href = 'checkout.html';
  }

  // Robust navbar wiring: both direct wiring and delegated click handling
  function wireNavbarCartIcons() {
    const navIcons = qsa('#navbar .bx-cart');
    if (!navIcons.length) return;
    navIcons.forEach(icon => {
      icon.removeEventListener('click', navIconClickHandler);
      icon.addEventListener('click', navIconClickHandler);
    });
  }
  function navIconClickHandler(e) {
    e.preventDefault();
    open();
  }

  // Delegated document-level handler so clicks work even if navbar injected later
  let __delegationBound = false;
  function bindDelegatedCartClick() {
    if (__delegationBound) return;
    __delegationBound = true;
    document.addEventListener('click', (e) => {
      const maybe = e.target.closest('#navbar .bx-cart');
      if (!maybe) return;
      e.preventDefault();
      // If cartAPI ready, open now; otherwise wait for ready then open
      try {
        if (window.cartAPI && typeof window.cartAPI.open === 'function') {
          window.cartAPI.open();
        } else if (window.cartAPIReady && typeof window.cartAPIReady.then === 'function') {
          // attempt to open once cartAPI resolves (user waited)
          window.cartAPIReady.then(api => {
            try { api.open(); } catch (err) {}
          }).catch(()=>{});
        } else {
          // nothing to do (cart.js may not be present) — optionally navigate to signin if not logged-in
          // leave as no-op so other code can handle it
        }
      } catch (err) { console.warn('delegated cart open failed', err); }
    }, { capture: false, passive: false });
  }

  // Public API
  const api = {
    add(product) { add(product); },
    setQty(id, qty) { setQty(id, qty); },
    remove(id) { removeItem(id); },
    open() { open(); },
    close() { close(); },
    getItems() { return itemsArray().map(i => ({ ...i })); },
    count() { return totalCount(); },
    clear() { clear(); },
    _render: renderDrawer,

    /*Anonymous → Logged-In Cart Migration*/
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
        localStorage.removeItem(STORAGE_KEY);
        currentStorageKey = userKey;
        load();
        save();
        renderDrawer();
        notifyCartChanged();
        return true;
      } catch (err) {
        console.warn('migrateAnonymousToUser failed', err);
        return false;
      }
    },

    useAnonymousAndClear() {
      try {
        close();
        currentStorageKey = STORAGE_KEY;
        cart = {};
        save();
        renderDrawer();
        notifyCartChanged();
      } catch (err) {
        console.warn('useAnonymousAndClear failed', err);
      }
    },

    // NEW: switch cart module to anonymous storage key WITHOUT clearing anonymous data.
    useAnonymous() {
      try {
        // Switch to anonymous storage key and load existing anonymous cart (do not clear)
        currentStorageKey = STORAGE_KEY;
        load();
        renderDrawer();
        notifyCartChanged();
      } catch (err) {
        console.warn('useAnonymous failed', err);
      }
    },

    setUserKey(userId) {
      try {
        if (!userId) return;
        currentStorageKey = `${STORAGE_KEY}_user_${userId}`;
        load();
        save();
        renderDrawer();
        notifyCartChanged();
      } catch (err) {
        console.warn('setUserKey failed', err);
      }
    }
  };

  // Fallback helper (available globally)
  // Use this when cartAPI is not ready — it merges product into canonical anonymous storage and emits 'cart:changed'
  window.cartAddFallback = function(product) {
    try {
      if (!product) return;
      const key = STORAGE_KEY;
      let obj = {};
      try { obj = JSON.parse(localStorage.getItem(key) || '{}'); } catch (e) { obj = {}; }
      const id = String(product.id || product);
      const qtyToAdd = Number(product.qty) || 1;
      if (obj[id]) {
        obj[id].qty = (Number(obj[id].qty || 0) + qtyToAdd);
      } else {
        obj[id] = {
          id,
          name: product.name || product.title || `Item ${id}`,
          price: Number(product.price || 0),
          image_url: product.image_url || product.image || '',
          qty: qtyToAdd
        };
      }
      localStorage.setItem(key, JSON.stringify(obj));
      // update staged snapshot and notify
      try { localStorage.setItem(STAGED_CHECKOUT_KEY, JSON.stringify(Object.values(obj))); } catch (e) {}
      try { document.dispatchEvent(new CustomEvent('cart:changed', { detail: { time: Date.now(), source: 'fallback' } })); } catch (e) {}
    } catch (err) {
      console.error('cartAddFallback failed', err);
    }
  };

  // Initialize
  function init() {
    load();
    ensureDrawer();
    const drawer = qs('#cart-drawer');
    if (drawer) {
      drawer.classList.add('translate-x-full');
      drawer.classList.remove('translate-x-0');
    }
    wireDrawerEvents();
    renderDrawer();

    // wire nav icons if navbar present now
    if (qs('#navbar')) wireNavbarCartIcons();

    // watch for navbar injection event and wire then
    document.addEventListener('navbar:ready', () => {
      setTimeout(() => {
        try { wireNavbarCartIcons(); renderDrawer(); } catch (e) {}
      }, 10);
    });

    // bind delegated listener (robust)
    bindDelegatedCartClick();

    // reload when other code reports cart:changed (e.g. fallback additions)
    document.addEventListener('cart:changed', () => {
      load();
      renderDrawer();
    });

    window.cartAPI = api;

    try { _cartReadyResolve && _cartReadyResolve(window.cartAPI); } catch (e) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();