// product-details.js (patched)
// Waits for cart readiness before calling cartAPI.add to avoid race that loses recently-added items.

document.addEventListener('DOMContentLoaded', async () => {
  const client = window.supabaseClient;
  const detailsEl = document.getElementById('product-details');
  const params = new URLSearchParams(window.location.search);
  const productId = params.get('id');

  if (!client || !productId || !detailsEl) {
    if (detailsEl) detailsEl.innerHTML =
      '<p class="text-red-500 text-center">Product not found.</p>';
    return;
  }

  try {
    const { data: product, error } = await client
      .from('products')
      .select('*')
      .eq('id', productId)
      .single();

    if (error || !product) {
      console.error('Supabase error:', error);
      detailsEl.innerHTML =
        '<p class="text-red-500 text-center">Product not found.</p>';
      return;
    }

    // UI TEMPLATE (same as before)
    detailsEl.innerHTML = `
      <div class="max-w-6xl mx-auto bg-white rounded-3xl shadow-xl p-6 md:p-10 grid grid-cols-1 md:grid-cols-2 gap-10">
        <div class="md:pr-10 md:border-r md:border-gray-200">
            <a href="shop.html" class="inline-flex items-center text-gray-500 hover:text-orange-500 font-medium mb-6 transition-colors">
                <i class="bx bx-left-arrow-alt mr-2 mt-1 text-lg"></i>
                Back to Shop
            </a>
            <div class="aspect-[4/3] w-full rounded-2xl flex items-center justify-center overflow-hidden">
            <img
                src="${product.image_url || ''}"
                alt="${product.name || ''}"
                class="w-full h-full object-contain transition-transform duration-300 hover:scale-105"/>
            </div>
        </div>

        <div class="flex flex-col justify-between">
          <div>
            <span class="inline-block bg-orange-500 text-white text-xs font-semibold px-3 py-1 rounded-full uppercase tracking-wide">
                ${product.category || ''}
            </span>

            <h1 class="text-3xl md:text-4xl font-bold text-slate-900 mt-2 mb-3">
              ${product.name || ''}
            </h1>

            <p class="text-3xl font-bold text-orange-600 mb-4">
              RM ${Number(product.price || 0).toFixed(2)}
            </p>

            <div class="flex items-center gap-2 mb-4">
              <div class="flex text-yellow-400 text-lg">
                <i class="bx bxs-star"></i><i class="bx bxs-star"></i><i class="bx bxs-star"></i><i class="bx bxs-star"></i><i class="bx bxs-star"></i>
              </div>
              <span class="text-sm text-gray-500">5.0 / 5.0</span>
            </div>

            <p class="text-gray-600 leading-relaxed mb-6">
              ${product.description || 'No description available.'}
            </p>

            <div class="flex items-center gap-4 mb-8">
              <span class="font-medium">Quantity</span>
              <div class="flex items-center border rounded-lg overflow-hidden">
                <button id="qty-decrease" class="px-4 py-2 bg-gray-100 hover:bg-gray-200 transition">−</button>
                <input id="qty-input" type="number" value="1" min="1" max="${product.stock || 99}" class="w-16 text-center focus:outline-none" />
                <button id="qty-increase" class="px-4 py-2 bg-gray-100 hover:bg-gray-200 transition">+</button>
              </div>
              <span class="text-base text-gray-500">Stock: ${product.stock ?? '∞'}</span>
            </div>
          </div>

          <button id="add-to-cart-btn" class="w-full bg-orange-500 hover:bg-orange-600 text-white text-lg font-semibold py-4 rounded-xl flex items-center justify-center gap-3 transition shadow-lg">
            <i class="bx bx-cart text-xl"></i>
            Add to Cart
          </button>

          <p class="text-sm text-gray-400 text-center mt-3">Secure transaction • High quality • Warranty included</p>
        </div>
      </div>
    `;

    // Quantity controls
    const qtyInput = document.getElementById('qty-input');
    const btnDecrease = document.getElementById('qty-decrease');
    const btnIncrease = document.getElementById('qty-increase');

    btnDecrease.addEventListener('click', () => {
      let val = parseInt(qtyInput.value, 10);
      if (val > 1) qtyInput.value = val - 1;
    });
    btnIncrease.addEventListener('click', () => {
      let val = parseInt(qtyInput.value, 10);
      if (val < (product.stock || 99)) qtyInput.value = val + 1;
    });
    qtyInput.addEventListener('input', () => {
      let val = parseInt(qtyInput.value, 10);
      if (isNaN(val) || val < 1) qtyInput.value = 1;
      if (product.stock && val > product.stock) qtyInput.value = product.stock;
    });

    // Add to cart (await cart readiness to avoid race)
    document.getElementById('add-to-cart-btn').addEventListener('click', async () => {
      const qty = parseInt(qtyInput.value, 10) || 1;
      const payload = {
        id: product.id,
        name: product.name,
        price: Number(product.price || 0),
        image_url: product.image_url || '',
        qty
      };

      // If cartAPI is available now, use it
      if (window.cartAPI && typeof window.cartAPI.add === 'function') {
        window.cartAPI.add(payload);
        return;
      }

      // Wait up to 1s for cartAPIReady promise (cart.js will resolve it)
      try {
        if (window.cartAPIReady instanceof Promise) {
          await Promise.race([
            window.cartAPIReady,
            new Promise(res => setTimeout(res, 1000))
          ]);
        }
      } catch (e) { /* ignore */ }

      // Try again
      if (window.cartAPI && typeof window.cartAPI.add === 'function') {
        window.cartAPI.add(payload);
        return;
      }

      // Final fallback: merge into localStorage under 'ys_cart_v1' (safe merge)
      try {
        const KEY = 'ys_cart_v1';
        const store = JSON.parse(localStorage.getItem(KEY) || '{}');
        const key = String(payload.id);
        if (store[key]) store[key].qty = (store[key].qty || 0) + payload.qty;
        else store[key] = { id: payload.id, name: payload.name || '', price: payload.price || 0, image_url: payload.image_url || '', qty: payload.qty };
        localStorage.setItem(KEY, JSON.stringify(store));
        // Optionally notify cart drawer via event (cart.js listens for 'navbar:ready' wiring; we fire cart:changed)
        try { document.dispatchEvent(new CustomEvent('cart:changed', { detail: { time: Date.now() } })); } catch (e) {}
      } catch (err) {
        console.error('Fallback add-to-cart failed', err);
      }
    });

  } catch (err) {
    console.error('Product fetch failed:', err);
    detailsEl.innerHTML =
      '<p class="text-red-500 text-center">Product not found.</p>';
  }
});