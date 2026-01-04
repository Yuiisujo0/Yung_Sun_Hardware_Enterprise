// checkout.js
function qs(sel, el = document) { return el.querySelector(sel); }
function formatRM(n) { return `RM${Number(n || 0).toFixed(2)}`; }

document.addEventListener('DOMContentLoaded', async () => {
  // If cart exposes a ready promise, wait for it so getItems() returns the right data.
  if (window.cartAPIReady && typeof window.cartAPIReady.then === 'function') {
    try { await window.cartAPIReady; } catch (e) { /* ignore */ }
  }

  const itemsContainer = qs('#checkout-items');
  if (!itemsContainer) return;

  const ANON_KEY = 'ys_cart_v1';

  // helper: find a user-scoped key if present
  function findUserScopedKey() {
    try {
      return Object.keys(localStorage).find(k => k.startsWith(`${ANON_KEY}_user_`)) || null;
    } catch (e) {
      return null;
    }
  }

  // Get items: prefer cartAPI if available, else fallback to localStorage (anon, then user-scoped, then staged checkout)
  function getCartItems() {
    try {
      if (window.cartAPI && typeof window.cartAPI.getItems === 'function') {
        const items = window.cartAPI.getItems();
        return Array.isArray(items) ? items : [];
      }

      // fallback: try anonymous key first
      const rawAnon = localStorage.getItem(ANON_KEY);
      if (rawAnon) {
        const obj = JSON.parse(rawAnon || '{}');
        return Object.values(obj);
      }

      // then try user-scoped key
      const userKey = findUserScopedKey();
      if (userKey) {
        const raw = localStorage.getItem(userKey);
        const obj = raw ? JSON.parse(raw) : {};
        return Object.values(obj);
      }

      // lastly check any staged checkout key
      const staged = localStorage.getItem('ys_cart_checkout');
      if (staged) {
        const arr = JSON.parse(staged);
        return Array.isArray(arr) ? arr : [];
      }

      return [];
    } catch (e) {
      console.error('Failed to load cart items', e);
      return [];
    }
  }

  // helper: write to the appropriate localStorage key when cartAPI not available
  function saveItemChangeToStorage(updatedObj) {
    try {
      // prefer anonymous key if exists; else user-scoped; else write to anonymous
      let keyToUse = ANON_KEY;
      const anonRaw = localStorage.getItem(ANON_KEY);
      if (!anonRaw) {
        const userKey = findUserScopedKey();
        if (userKey) keyToUse = userKey;
      }
      localStorage.setItem(keyToUse, JSON.stringify(updatedObj));
    } catch (e) {
      console.error('Failed to persist cart fallback', e);
    }
  }

  function renderCheckout() {
    const items = getCartItems();

    if (!items || !items.length) {
      itemsContainer.innerHTML = '<p class="text-gray-500">No items in cart.</p>';
      qs('#summary-subtotal').textContent = formatRM(0);
      qs('#summary-tax').textContent = formatRM(0);
      qs('#summary-shipping').textContent = formatRM(10);
      qs('#summary-total').textContent = formatRM(10);
      return;
    }

    let subtotal = 0;

    itemsContainer.innerHTML = items.map(it => {
      const itemTotal = Number(it.price || 0) * Number(it.qty || 0);
      subtotal += itemTotal;

      return `
      <div class="bg-white shadow rounded-xl p-4 flex items-start justify-between" data-id="${it.id}">
        <div class="flex items-center gap-3">
          <img src="${it.image_url || ''}" alt="${it.name || ''}" class="w-20 h-20 object-contain rounded">
          <div>
            <div class="font-semibold text-lg">${it.name || ''}</div>
            <div class="text-sm text-gray-500 flex items-center gap-2 mt-2">
              Qty:
              <button class="qty-btn px-2 py-1 bg-gray-200 rounded" data-action="decrease">−</button>
              <input type="number" class="qty-input w-12 text-center border rounded" value="${it.qty || 0}" min="1">
              <button class="qty-btn px-2 py-1 bg-gray-200 rounded" data-action="increase">+</button>
            </div>
          </div>
        </div>

        <div class="flex flex-col items-end">
          <div class="font-bold text-orange-600 mb-2">${formatRM(itemTotal)}</div>
          <button class="remove-btn text-red-600 hover:bg-red-200 rounded-full p-2 transition" data-action="remove" aria-label="Remove item">
            <i class="bx bx-trash text-xl"></i>
          </button> 
        </div>
      </div>`;
    }).join('');

    const tax = subtotal * 0.06;
    const shipping = 10;
    const total = subtotal + tax + shipping;

    qs('#summary-subtotal').textContent = formatRM(subtotal);
    qs('#summary-tax').textContent = formatRM(tax);
    qs('#summary-shipping').textContent = formatRM(shipping);
    qs('#summary-total').textContent = formatRM(total);
  }

  // initial render
  renderCheckout();

  // Helper to mutate fallback storage item qty
  function modifyStorageQty(id, deltaOrSetTo) {
    try {
      // find the right storage object
      let keyToUse = ANON_KEY;
      let raw = localStorage.getItem(ANON_KEY);
      if (!raw) {
        const userKey = findUserScopedKey();
        if (userKey) {
          keyToUse = userKey;
          raw = localStorage.getItem(userKey);
        }
      }
      const obj = raw ? JSON.parse(raw) : {};
      const item = obj[String(id)];
      if (!item) return;

      if (typeof deltaOrSetTo === 'number') {
        // if deltaOrSetTo is integer and we interpret as change
        if (Number.isInteger(deltaOrSetTo) && deltaOrSetTo !== 0) {
          item.qty = (Number(item.qty || 0) + deltaOrSetTo);
        } else {
          // set absolute
          item.qty = deltaOrSetTo;
        }
      }

      if (!item.qty || Number(item.qty) <= 0) {
        delete obj[String(id)];
      } else {
        obj[String(id)] = item;
      }
      localStorage.setItem(keyToUse, JSON.stringify(obj));
    } catch (e) {
      console.error('modifyStorageQty failed', e);
    }
  }

  // Delegate quantity + remove controls
  itemsContainer.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;

    const itemEl = e.target.closest('[data-id]');
    if (!itemEl) return;

    const id = itemEl.getAttribute('data-id');
    const action = btn.dataset.action;

    // Prefer cartAPI operations if available
    if (window.cartAPI) {
      try {
        if (action === 'increase') {
          if (typeof window.cartAPI.add === 'function') {
            window.cartAPI.add({ id, qty: 1 });
          } else if (typeof window.cartAPI.setQty === 'function') {
            // read current then set
            const current = (window.cartAPI.getItems() || []).find(i => String(i.id) === String(id));
            const newQty = (current?.qty || 0) + 1;
            window.cartAPI.setQty(id, newQty);
          }
        } else if (action === 'decrease') {
          if (typeof window.cartAPI.setQty === 'function') {
            const current = (window.cartAPI.getItems() || []).find(i => String(i.id) === String(id));
            const newQty = (current?.qty || 0) - 1;
            window.cartAPI.setQty(id, newQty);
          } else if (typeof window.cartAPI.add === 'function') {
            window.cartAPI.add({ id, qty: -1 });
          }
        } else if (action === 'remove') {
          if (typeof window.cartAPI.setQty === 'function') {
            window.cartAPI.setQty(id, 0);
          } else if (typeof window.cartAPI.remove === 'function') {
            window.cartAPI.remove(id);
          } else {
            // last resort: manipulate localStorage fallback
            modifyStorageQty(id, 0);
          }
        }
      } catch (err) {
        console.error('cartAPI operation failed', err);
      }
    } else {
      // fallback direct localStorage manipulation
      if (action === 'increase') modifyStorageQty(id, 1);
      else if (action === 'decrease') modifyStorageQty(id, -1);
      else if (action === 'remove') modifyStorageQty(id, 0);
    }

    // re-render (cart module should also re-render via its own listeners)
    renderCheckout();
  });

  // Direct input quantity update
  itemsContainer.addEventListener('input', e => {
    const input = e.target;
    if (!input.classList.contains('qty-input')) return;

    const itemEl = input.closest('[data-id]');
    if (!itemEl) return;

    const id = itemEl.getAttribute('data-id');
    const val = parseInt(input.value, 10);

    if (window.cartAPI && typeof window.cartAPI.setQty === 'function') {
      if (Number.isNaN(val) || val < 1) window.cartAPI.setQty(id, 0);
      else window.cartAPI.setQty(id, val);
    } else {
      try {
        if (Number.isNaN(val) || val < 1) modifyStorageQty(id, 0);
        else modifyStorageQty(id, val);
      } catch (err) { console.error(err); }
    }

    renderCheckout();
  });

  // Listen to external cart changes (e.g. navbar migration fallback dispatched 'cart:changed')
  document.addEventListener('cart:changed', () => {
    // re-render after a small delay to allow other code to finish moving storage
    setTimeout(renderCheckout, 20);
  });

  // ===== Modal for login/signup =====
  function showLoginModal() {
    let modal = document.getElementById('login-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'login-modal';
      modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
      modal.innerHTML = `
        <div class="bg-white rounded-xl shadow-lg w-96 p-6 relative">
          <h3 class="text-lg font-semibold mb-4">Login Required</h3>
          <p class="text-gray-600 mb-6">
            You need to login to proceed to checkout. 
          </p>
          <div class="flex justify-end gap-2">
            <button id="modal-cancel" class="px-4 py-2 rounded bg-gray-200 hover:bg-gray-300 transition">Cancel</button>
            <button id="modal-login" class="px-4 py-2 rounded bg-orange-600 text-white hover:bg-orange-700 transition">Login</button>
          </div>
        </div>`;
      document.body.appendChild(modal);

      modal.querySelector('#modal-cancel').addEventListener('click', () => modal.remove());

      modal.querySelector('#modal-login').addEventListener('click', () => {
        localStorage.setItem('redirectAfterLogin', window.location.href); // save current page
        window.location.href = 'signin.html';
      });
    }
  }

  // ===== Place Order button ===== 
  const placeBtn = qs('#place-order-btn');
  if (placeBtn) {
    placeBtn.addEventListener('click', async () => {
      const items = getCartItems();
      if (!items || !items.length) { alert('Cart is empty.'); return; }

      const client = window.supabaseClient;
      if (!client) { alert('Supabase client not initialized.'); return; }

      try {
        const { data: { session }, error } = await client.auth.getSession();
        if (error) throw error;

        if (!session) {
          // Show login/signup modal if not logged in
          showLoginModal();
          return;
        }

        // User is logged in → save items for payment page (staging)
        localStorage.setItem('ys_cart_checkout', JSON.stringify(items));

        // Redirect to payment page
        window.location.href = 'payment.html';

      } catch (err) {
        console.error('Auth check failed:', err);
        alert('Failed to verify login. Please try again.');
      }
    });
  }

});