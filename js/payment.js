const client = window.supabaseClient;

// ===== Utility Functions =====
function qs(sel, el = document) { return el.querySelector(sel); }
function formatRM(n) { return `RM${Number(n || 0).toFixed(2)}`; }

// ===== Load Cart Items =====
function getCartItems() {
  try {
    const raw = localStorage.getItem('ys_cart_v1');
    const obj = raw ? JSON.parse(raw) : {};
    return Object.values(obj);
  } catch (e) {
    console.error('Failed to load cart', e);
    return [];
  }
}

// ===== Render Order Summary =====
function renderOrderSummary() {
  const items = getCartItems();
  let subtotal = 0;
  items.forEach(it => subtotal += Number(it.price) * Number(it.qty));

  const tax = subtotal * 0.06; // 6% tax
  const shipping = 10; // or 0 if free
  const total = subtotal + tax + shipping;

  qs('#subtotal').textContent = formatRM(subtotal);
  qs('#tax').textContent = formatRM(tax);
  qs('#total').textContent = formatRM(total);
}

// ===== Payment Tabs =====
function setupPaymentTabs() {
  const tabs = { tabCard: 'payment-card', tabFPX: 'payment-fpx', tabEwallet: 'payment-ewallet' };
  Object.keys(tabs).forEach(tabId => {
    const btn = qs(`#${tabId}`);
    btn.addEventListener('click', () => {
      Object.keys(tabs).forEach(t => {
        qs(`#${t}`).classList.remove('bg-orange-50', 'text-orange-600', 'border-orange-500');
        qs(`#${t}`).classList.add('border-slate-100', 'text-slate-500');
        qs(`#${tabs[t]}`).classList.add('hidden');
      });
      btn.classList.add('bg-orange-50', 'text-orange-600', 'border-orange-500');
      btn.classList.remove('border-slate-100', 'text-slate-500');
      qs(`#${tabs[tabId]}`).classList.remove('hidden');
    });
  });
}

// ===== Show Payment Success Modal =====
function showPaymentModal(message) {
  let modal = document.createElement('div');
  modal.id = 'payment-modal';
  modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
  modal.innerHTML = `
    <div class="bg-white rounded-2xl shadow-lg p-8 max-w-md text-center">
      <h2 class="text-xl font-bold text-slate-800 mb-4">Payment Successful!</h2>
      <p class="text-slate-600 mb-6">${message}</p>
      <button id="backHome" class="bg-orange-600 text-white px-6 py-3 rounded-xl hover:bg-orange-700 transition">Back to Home</button>
    </div>
  `;
  document.body.appendChild(modal);

  qs('#backHome').addEventListener('click', () => {
    window.location.href = 'index.html';
  });

  // Auto redirect after 5 seconds
  setTimeout(() => window.location.href = 'index.html', 5000);
}

// ===== Handle Payment Submission =====
qs('#paymentForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const items = getCartItems();
  if (!items.length) return alert('Cart is empty');

  const { data: { session }, error: sessionError } = await client.auth.getSession();
  if (sessionError || !session) {
    alert('Please login first!');
    return;
  }
  const userId = session.user.id;

  // Shipping info
  const shipping = {
    full_name: qs('#fullName').value.trim(),
    email: qs('#email').value.trim(),
    address: qs('#address').value.trim(),
    city: qs('#city').value.trim(),
    postal_code: qs('#postalCode').value.trim()
  };
  if (!shipping.full_name || !shipping.email || !shipping.address || !shipping.city || !shipping.postal_code) {
    return alert('Please fill all shipping details.');
  }

  // Payment method
  let paymentMethod = 'Card';
  if (!qs('#payment-card').classList.contains('hidden')) paymentMethod = 'Card';
  else if (!qs('#payment-fpx').classList.contains('hidden')) paymentMethod = 'FPX';
  else if (!qs('#payment-ewallet').classList.contains('hidden')) paymentMethod = 'E-Wallet';

  try {
    const subtotal = items.reduce((sum, it) => sum + it.price * it.qty, 0);
    const totalAmount = subtotal * 1.06 + 10; // 6% tax + shipping fee

    // Insert order with shipping info
    const { data: orderData, error: orderError } = await client
      .from('orders')
      .insert([{
        user_id: userId,
        full_name: shipping.full_name,
        email: shipping.email,
        address: shipping.address,
        city: shipping.city,
        postal_code: shipping.postal_code,
        total_amount: totalAmount,
        payment_method: paymentMethod,
        status: 'paid'
      }])
      .select()
      .single();

    if (orderError) throw orderError;
    const orderId = orderData.id;

    // Insert order items
    const orderItems = items.map(it => ({
      order_id: orderId,
      product_id: it.id,
      name: it.name,
      price: it.price,
      qty: it.qty
    }));
    const { error: itemsError } = await client.from('order_items').insert(orderItems);
    if (itemsError) throw itemsError;

    // Clear cart
    localStorage.removeItem('ys_cart_v1');
    if (window.cartAPI) window.cartAPI.clear();

    // Show modal
    showPaymentModal('Thank you for your payment! Your items will be shipped in 3 days. Please check your email for your order details.');

  } catch (err) {
    console.error('Payment failed', err);
    alert('Payment failed. Check console for details.');
  }
});

// ===== Initialize =====
renderOrderSummary();
setupPaymentTabs();
