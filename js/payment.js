const client = window.supabaseClient;

// =======================
// Utility Functions
// =======================
function qs(sel, el = document) {
  return el.querySelector(sel);
}
function formatRM(n) {
  return `RM ${Number(n || 0).toFixed(2)}`;
}

const ANON_KEY = 'ys_cart_v1';
const STAGED_KEY = 'ys_cart_checkout';

// Helper: wait for cart module to initialize if it exposes a ready promise
async function waitForCartReady(timeout = 1500) {
  if (window.cartAPIReady && typeof window.cartAPIReady.then === 'function') {
    try {
      await Promise.race([
        window.cartAPIReady,
        new Promise((_, rej) => setTimeout(() => rej(new Error('cartAPIReady timeout')), timeout))
      ]);
    } catch (e) {
      // ignore timeout/failure — we will fallback to localStorage
    }
  } else {
    // if no promise, allow a small tick for cart.js to run
    await new Promise(r => setTimeout(r, 10));
  }
}

// =======================
// Cart Handling
// =======================
function findUserScopedKey() {
  try {
    return Object.keys(localStorage).find(k => k.startsWith(`${ANON_KEY}_user_`)) || null;
  } catch (e) {
    return null;
  }
}

function getCartItemsFallbackFromStorage() {
  try {
    // Priority: staged checkout array, user-scoped object, anonymous object
    const stagedRaw = localStorage.getItem(STAGED_KEY);
    if (stagedRaw) {
      const arr = JSON.parse(stagedRaw);
      if (Array.isArray(arr)) return arr;
    }

    const userKey = findUserScopedKey();
    if (userKey) {
      const raw = localStorage.getItem(userKey);
      if (raw) {
        const obj = JSON.parse(raw || '{}');
        return Object.values(obj);
      }
    }

    const anonRaw = localStorage.getItem(ANON_KEY);
    if (anonRaw) {
      const obj = JSON.parse(anonRaw || '{}');
      return Object.values(obj);
    }

    return [];
  } catch (e) {
    console.error('getCartItemsFallbackFromStorage failed', e);
    return [];
  }
}

async function getCartItems() {
  // Try cartAPI first (if ready)
  try {
    if (window.cartAPI) {
      if (typeof window.cartAPI.getItems === 'function') {
        const items = window.cartAPI.getItems();
        if (Array.isArray(items) && items.length) return items;
        // if cartAPI returns empty array, still fall through to check staged key
      }
    }
  } catch (e) {
    console.warn('cartAPI.getItems failed', e);
  }

  // fallback to staged or storage
  return getCartItemsFallbackFromStorage();
}

// =======================
// Order Summary
// =======================
async function renderOrderSummary() {
  const items = await getCartItems();
  const orderItemsContainer = qs('#orderItems');
  if (!orderItemsContainer) return;

  orderItemsContainer.innerHTML = ''; // clear

  let subtotal = 0;
  if (!items || items.length === 0) {
    orderItemsContainer.innerHTML = `<p class="text-gray-500">No items in cart.</p>`;
  } else {
    items.forEach(it => {
      const qty = Number(it.qty || 0);
      const price = Number(it.price || 0);
      const lineTotal = qty * price;
      subtotal += lineTotal;

      const div = document.createElement('div');
      div.className = 'flex items-center gap-3';
      div.innerHTML = `
        <img src="${it.image_url || ''}" alt="${it.name || ''}" class="w-14 h-14 object-contain rounded">
        <div class="flex-1">
          <div class="font-medium">${it.name || ''}</div>
          <div class="text-sm text-gray-500">Qty: ${qty}</div>
        </div>
        <div class="font-semibold text-orange-600">${formatRM(lineTotal)}</div>
      `;
      orderItemsContainer.appendChild(div);
    });
  }

  const tax = subtotal * 0.06;
  const shipping = 10;
  const total = subtotal + tax + shipping;

  if (qs('#subtotal')) qs('#subtotal').textContent = formatRM(subtotal);
  if (qs('#tax')) qs('#tax').textContent = formatRM(tax);
  if (qs('#total')) qs('#total').textContent = formatRM(total);
}

// =======================
// Payment Tabs
// =======================
function setupPaymentTabs() {
  const tabs = {
    tabCard: "payment-card",
    tabFPX: "payment-fpx",
    tabEwallet: "payment-ewallet"
  };

  Object.keys(tabs).forEach(tabId => {
    const el = qs(`#${tabId}`);
    if (!el) return;
    el.addEventListener("click", () => {
      Object.keys(tabs).forEach(t => {
        const btn = qs(`#${t}`);
        if (btn) {
          btn.classList.remove('bg-orange-50','text-orange-600','border-orange-500');
          btn.classList.add('text-slate-500','border-slate-200');
        }
        const panel = qs(`#${tabs[t]}`);
        if (panel) panel.classList.add('hidden');
      });

      const btn = qs(`#${tabId}`);
      if (btn) btn.classList.add('bg-orange-50','text-orange-600','border-orange-500');
      const panel = qs(`#${tabs[tabId]}`);
      if (panel) panel.classList.remove('hidden');

      updatePayButton();
    });
  });

  const defaultBtn = qs('#tabCard');
  if (defaultBtn) defaultBtn.click();
}

// =======================
// E-Wallet Logic
// =======================
let selectedEwallet = null;

function setupEwalletSelection() {
  const ewalletRadios = document.querySelectorAll("input[name='ewallet']");
  const qrSection = document.getElementById("qrSection");
  const qrImage = document.getElementById("qrImage");

  ewalletRadios.forEach(radio => {
    radio.addEventListener("change", () => {
      selectedEwallet = radio.value;

      ewalletRadios.forEach(r =>
        r.closest("label").classList.remove("border-orange-500","bg-orange-50")
      );

      radio.closest("label").classList.add("border-orange-500","bg-orange-50");

      const totalText = (qs("#total")?.textContent || '').replace("RM","").trim();
      const total = totalText || '0.00';

      if (qrImage) {
        qrImage.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=YungSun-${selectedEwallet}-RM${total}&color=${selectedEwallet === 'TNG' ? '0055AA' : 'D40054'}`;
      }

      if (qrSection) qrSection.classList.remove("hidden");
      updatePayButton();
    });
  });
}

function updatePayButton() {
  const payBtn = qs('#payBtn');
  if (!payBtn) return;
  const isEwallet = !qs("#payment-ewallet")?.classList.contains("hidden");

  if (isEwallet) {
    payBtn.textContent = "Verify Payment";
    if (!selectedEwallet) {
      payBtn.disabled = true;
      payBtn.classList.add("opacity-50","cursor-not-allowed");
    } else {
      payBtn.disabled = false;
      payBtn.classList.remove("opacity-50","cursor-not-allowed");
    }
  } else {
    payBtn.textContent = "Pay Now";
    payBtn.disabled = false;
    payBtn.classList.remove("opacity-50","cursor-not-allowed");
  }
}

// =======================
// Success Modal
// =======================
function showPaymentModal(message) {
  const modal = document.createElement("div");
  modal.className = "fixed inset-0 bg-black/50 flex items-center justify-center z-50";
  modal.innerHTML = `
    <div class="bg-white p-8 rounded-2xl shadow-xl text-center max-w-md">
      <h2 class="text-xl font-bold mb-3 text-slate-800">Payment Successful</h2>
      <p class="text-slate-600 mb-6">${message}</p>
      <button id="goHome"
        class="bg-orange-600 text-white px-6 py-3 rounded-xl hover:bg-orange-700">
        Back to Home
      </button>
    </div>
  `;
  document.body.appendChild(modal);

  qs("#goHome").onclick = () => {
    window.location.href = "index.html";
  };

  setTimeout(() => (window.location.href = "index.html"), 10000);
}

// =======================
// Payment Submit
// =======================
async function handlePaymentSubmit(e) {
  e.preventDefault();

  const items = await getCartItems();
  if (!items || items.length === 0) return alert("Cart is empty");

  // Ensure supabase client available
  if (!client) return alert("Please try again later");

  try {
    const { data: { session }, error } = await client.auth.getSession();
    if (error || !session) {
      return alert("Please login first");
    }

    const shipping = {
      full_name: qs("#fullName").value.trim(),
      email: qs("#email").value.trim(),
      address: qs("#address").value.trim(),
      city: qs("#city").value.trim(),
      postal_code: qs("#postalCode").value.trim()
    };

    if (Object.values(shipping).some(v => !v)) {
      return alert("Please fill all shipping details");
    }

    let paymentMethod = "Card";
    if (!qs("#payment-fpx").classList.contains("hidden")) {
      paymentMethod = "FPX";
    }
    if (!qs("#payment-ewallet").classList.contains("hidden")) {
      if (!selectedEwallet) return alert("Select an E-Wallet");
      paymentMethod = `E-Wallet (${selectedEwallet})`;
    }

    const payBtn = qs("#payBtn");
    if (payBtn) {
      payBtn.disabled = true;
      payBtn.textContent = "Processing...";
    }

    // compute totals
    const subtotal = items.reduce((s, it) => s + Number(it.price || 0) * Number(it.qty || 0), 0);
    const totalAmount = subtotal * 1.06 + 10;

    // Insert order
    const { data: order, error: orderErr } = await client
      .from("orders")
      .insert([{
        user_id: session.user.id,
        ...shipping,
        total_amount: totalAmount,
        payment_method: paymentMethod,
        status: "paid"
      }])
      .select()
      .single();
    if (orderErr) throw orderErr;

    // Insert order items
    await client.from("order_items").insert(
      items.map(it => ({
        order_id: order.id,
        product_id: it.id,
        name: it.name,
        price: it.price,
        qty: it.qty
      }))
    );

    // Update stock
    for (let it of items) {
      const { data: p } = await client
        .from("products")
        .select("stock")
        .eq("id", it.id)
        .single();

      if (p.stock < it.qty) throw new Error("Insufficient stock");

      await client
        .from("products")
        .update({ stock: p.stock - it.qty })
        .eq("id", it.id);
    }

    // Clear local storage keys and cart module
    try {
      // Remove staged checkout array
      localStorage.removeItem(STAGED_KEY);
      // Remove anonymous key
      localStorage.removeItem(ANON_KEY);
      // Remove user-scoped key for current user (if exists)
      const userKey = findUserScopedKey();
      // If userKey contains user id mismatch, safe to remove only if it's the logged-in user's key
      if (userKey && userKey.endsWith(session.user.id)) {
        localStorage.removeItem(userKey);
      }
      if (window.cartAPI && typeof window.cartAPI.clear === 'function') {
        window.cartAPI.clear();
      }
    } catch (e) {
      console.warn('Failed to clear cart storage', e);
    }

    showPaymentModal("Thank you! Your order is confirmed. Please check your email for order details.");
  } catch (err) {
    console.error(err);
    alert("Payment failed. Please try again.");
  } finally {
    const payBtn = qs("#payBtn");
    if (payBtn) {
      payBtn.disabled = false;
      payBtn.textContent = "Pay Now";
    }
  }
}

// =======================
// Init
// =======================
(async function init() {
  await waitForCartReady();

  // initial render
  await renderOrderSummary();

  setupPaymentTabs();
  setupEwalletSelection();

  // bind form submit
  const form = qs('#paymentForm');
  if (form) form.addEventListener('submit', handlePaymentSubmit);

  // Re-render order summary if cart changes elsewhere
  document.addEventListener('cart:changed', () => setTimeout(renderOrderSummary, 20));
})();