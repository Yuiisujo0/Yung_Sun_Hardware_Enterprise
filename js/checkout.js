// checkout.js
function qs(sel, el = document) { return el.querySelector(sel); }
function formatRM(n) { return `RM${Number(n || 0).toFixed(2)}`; }

document.addEventListener('DOMContentLoaded', () => {
  const itemsContainer = qs('#checkout-items');

  // Get items: prefer cartAPI if available, else fallback to localStorage
  function getCartItems() {
    if (window.cartAPI) {
      return window.cartAPI.getItems();
    } else {
      try {
        const raw = localStorage.getItem('ys_cart_v1');
        const obj = raw ? JSON.parse(raw) : {};
        return Object.values(obj);
      } catch (e) {
        console.error('Failed to load cart from localStorage', e);
        return [];
      }
    }
  }

  function renderCheckout() {
    const items = getCartItems();

    if (!items.length) {
      itemsContainer.innerHTML = '<p class="text-gray-500">No items in cart.</p>';
      qs('#summary-subtotal').textContent = formatRM(0);
      qs('#summary-tax').textContent = formatRM(0);
      qs('#summary-shipping').textContent = formatRM(10);
      qs('#summary-total').textContent = formatRM(10);
      return;
    }

    let subtotal = 0;

    itemsContainer.innerHTML = items.map(it => {
      const itemTotal = Number(it.price) * Number(it.qty);
      subtotal += itemTotal;

      return `
      <div class="bg-white shadow rounded-xl p-4 flex items-start justify-between" data-id="${it.id}">
        <div class="flex items-center gap-3">
          <img src="${it.image_url}" alt="${it.name}" class="w-20 h-20 object-contain rounded">
          <div>
            <div class="font-semibold text-lg">${it.name}</div>
            <div class="text-sm text-gray-500 flex items-center gap-2 mt-2">
              Qty:
              <button class="qty-btn px-2 py-1 bg-gray-200 rounded" data-action="decrease">−</button>
              <input type="number" class="qty-input w-12 text-center border rounded" value="${it.qty}" min="1">
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

  // Initial render
  renderCheckout();

  // Delegate quantity + remove controls
  itemsContainer.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;

    const itemEl = e.target.closest('[data-id]');
    if (!itemEl) return;

    const id = itemEl.getAttribute('data-id');

    if (window.cartAPI) {
      if (btn.dataset.action === 'increase') window.cartAPI.add({ id, qty: 1 });
      else if (btn.dataset.action === 'decrease') window.cartAPI.add({ id, qty: -1 });
      else if (btn.dataset.action === 'remove') window.cartAPI.setQty(id, 0);
    } else {
      try {
        const raw = localStorage.getItem('ys_cart_v1');
        const obj = raw ? JSON.parse(raw) : {};
        const item = obj[id];
        if (!item) return;

        if (btn.dataset.action === 'increase') item.qty += 1;
        else if (btn.dataset.action === 'decrease') item.qty -= 1;
        else if (btn.dataset.action === 'remove') item.qty = 0;

        if (item.qty <= 0) delete obj[id];
        else obj[id] = item;

        localStorage.setItem('ys_cart_v1', JSON.stringify(obj));
      } catch (err) { console.error(err); }
    }

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

    if (window.cartAPI) {
      if (Number.isNaN(val) || val < 1) window.cartAPI.setQty(id, 0);
      else window.cartAPI.setQty(id, val);
    } else {
      try {
        const raw = localStorage.getItem('ys_cart_v1');
        const obj = raw ? JSON.parse(raw) : {};
        if (!obj[id]) return;

        if (Number.isNaN(val) || val < 1) delete obj[id];
        else obj[id].qty = val;

        localStorage.setItem('ys_cart_v1', JSON.stringify(obj));
      } catch (err) { console.error(err); }
    }

    renderCheckout();
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
  qs('#place-order-btn').addEventListener('click', async () => {
    const items = getCartItems();
    if (!items.length) { alert('Cart is empty.'); return; }

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

      // User is logged in, proceed
      alert('Order placed successfully!');
      if (window.cartAPI) window.cartAPI.clear();
      localStorage.removeItem('ys_cart_v1');
      localStorage.removeItem('ys_cart_checkout');

      window.location.href = './'; // redirect home or order confirmation
    } catch (err) {
      console.error('Auth check failed:', err);
      alert('Failed to verify login. Please try again.');
    }
  });


});
