document.addEventListener('DOMContentLoaded', async () => {
  const client = window.supabaseClient;
  const detailsEl = document.getElementById('product-details');
  const params = new URLSearchParams(window.location.search);
  const productId = params.get('id');

  if (!client || !productId || !detailsEl) {
    detailsEl.innerHTML =
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

    // ----------------------------
    // UI TEMPLATE
    // ----------------------------
    detailsEl.innerHTML = `
      <div class="max-w-6xl mx-auto bg-white rounded-3xl shadow-xl p-6 md:p-10 grid grid-cols-1 md:grid-cols-2 gap-10">

        <!-- LEFT : IMAGE -->
        <div class="md:pr-10 md:border-r md:border-gray-200">
            <a href="shop.html" class="inline-flex items-center text-gray-500 hover:text-orange-500 font-medium mb-6 transition-colors">
                <i class="bx bx-left-arrow-alt mr-2 mt-1 text-lg"></i>
                Back to Shop
            </a>

            <div class="aspect-[4/3] w-full rounded-2xl flex items-center justify-center overflow-hidden">
            <img
                src="${product.image_url}"
                alt="${product.name}"
                class="w-full h-full object-contain transition-transform duration-300 hover:scale-105"/>
            </div>
        </div>

        <!-- RIGHT : PRODUCT INFO -->
        <div class="flex flex-col justify-between">
          <div>
            <span class="inline-block bg-orange-500 text-white text-xs font-semibold px-3 py-1 rounded-full uppercase tracking-wide">
                ${product.category}
            </span>

            <h1 class="text-3xl md:text-4xl font-bold text-slate-900 mt-2 mb-3">
              ${product.name}
            </h1>

            <!-- Price -->
            <p class="text-3xl font-bold text-orange-600 mb-4">
              RM ${Number(product.price).toFixed(2)}
            </p>
            
            <!-- Rating -->
            <div class="flex items-center gap-2 mb-4">
              <div class="flex text-yellow-400 text-lg">
                <i class="bx bxs-star"></i>
                <i class="bx bxs-star"></i>
                <i class="bx bxs-star"></i>
                <i class="bx bxs-star"></i>
                <i class="bx bxs-star"></i>
              </div>
              <span class="text-sm text-gray-500">5.0 / 5.0</span>
            </div>

            
            <!-- Description -->
            <p class="text-gray-600 leading-relaxed mb-6">
              ${product.description || 'No description available.'}
            </p>

            <!-- Quantity Selector -->
            <div class="flex items-center gap-4 mb-8">
              <span class="font-medium">Quantity</span>

              <div class="flex items-center border rounded-lg overflow-hidden">
                <button
                  id="qty-decrease"
                  class="px-4 py-2 bg-gray-100 hover:bg-gray-200 transition"
                >−</button>

                <input
                  id="qty-input"
                  type="number"
                  value="1"
                  min="1"
                  max="${product.stock || 99}"
                  class="w-16 text-center focus:outline-none"
                />

                <button
                  id="qty-increase"
                  class="px-4 py-2 bg-gray-100 hover:bg-gray-200 transition"
                >+</button>
              </div>

              <span class="text-base text-gray-500">
                Stock: ${product.stock ?? '∞'}
              </span>
            </div>
          </div>

          <!-- ADD TO CART -->
          <button
            id="add-to-cart-btn"
            class="w-full bg-orange-500 hover:bg-orange-600 text-white text-lg font-semibold py-4 rounded-xl flex items-center justify-center gap-3 transition shadow-lg"
          >
            <i class="bx bx-cart text-xl"></i>
            Add to Cart
          </button>

          <p class="text-sm text-gray-400 text-center mt-3">
            Secure transaction • High quality • Warranty included
          </p>
        </div>
      </div>
    `;

    // ----------------------------
    // QUANTITY CONTROLS
    // ----------------------------
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

    // ----------------------------
    // ADD TO CART
    // ----------------------------
    document.getElementById('add-to-cart-btn').addEventListener('click', () => {
      const payload = {
        ...product,
        qty: parseInt(qtyInput.value, 10) || 1
      };

      if (window.cartAPI && typeof window.cartAPI.add === 'function') {
        window.cartAPI.add(payload);
      } else {
        console.warn('cartAPI not found');
      }
    });

  } catch (err) {
    console.error('Product fetch failed:', err);
    detailsEl.innerHTML =
      '<p class="text-red-500 text-center">Product not found.</p>';
  }
});
