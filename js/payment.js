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

// =======================
// Cart Handling
// =======================
function getCartItems() {
  try {
    const raw = localStorage.getItem("ys_cart_v1");
    const obj = raw ? JSON.parse(raw) : {};
    return Object.values(obj);
  } catch (e) {
    console.error("Failed to load cart", e);
    return [];
  }
}

// =======================
// Order Summary
// =======================
function renderOrderSummary() {
  const items = getCartItems();
  let subtotal = 0;

  items.forEach(it => {
    subtotal += Number(it.price) * Number(it.qty);
  });

  const tax = subtotal * 0.06;
  const shipping = 10;
  const total = subtotal + tax + shipping;

  qs("#subtotal").textContent = formatRM(subtotal);
  qs("#tax").textContent = formatRM(tax);
  qs("#total").textContent = formatRM(total);
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
    qs(`#${tabId}`).addEventListener("click", () => {
      Object.keys(tabs).forEach(t => {
        qs(`#${t}`).classList.remove(
          "bg-orange-50",
          "text-orange-600",
          "border-orange-500"
        );
        qs(`#${t}`).classList.add("text-slate-500", "border-slate-200");
        qs(`#${tabs[t]}`).classList.add("hidden");
      });

      qs(`#${tabId}`).classList.add(
        "bg-orange-50",
        "text-orange-600",
        "border-orange-500"
      );
      qs(`#${tabs[tabId]}`).classList.remove("hidden");

      updatePayButton();
    });
  });

  qs("#tabCard").click(); // default
}

// =======================
// E-Wallet Logic
// =======================
let selectedEwallet = null;

const ewalletRadios = document.querySelectorAll("input[name='ewallet']");
const qrSection = document.getElementById("qrSection");
const qrImage = document.getElementById("qrImage");
const payBtn = document.getElementById("payBtn");

function setupEwalletSelection() {
  ewalletRadios.forEach(radio => {
    radio.addEventListener("change", () => {
      selectedEwallet = radio.value;

      ewalletRadios.forEach(r =>
        r.closest("label").classList.remove(
          "border-orange-500",
          "bg-orange-50"
        )
      );

      radio.closest("label").classList.add(
        "border-orange-500",
        "bg-orange-50"
      );

      const total = qs("#total").textContent.replace("RM", "").trim();

      qrImage.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=YungSun-${selectedEwallet}-RM${total}&color=${selectedEwallet === 'TNG' ? '0055AA' : 'D40054'}`;

      qrSection.classList.remove("hidden");
      updatePayButton();
    });
  });
}

function updatePayButton() {
  const isEwallet = !qs("#payment-ewallet").classList.contains("hidden");
  
  if (isEwallet) {
    payBtn.textContent = "Verify Payment";
    if (!selectedEwallet) {
      payBtn.disabled = true;
      payBtn.classList.add("opacity-50", "cursor-not-allowed");
    } else {
      payBtn.disabled = false;
      payBtn.classList.remove("opacity-50", "cursor-not-allowed");
    }
  } else {
    payBtn.textContent = "Pay Now";
    payBtn.disabled = false;
    payBtn.classList.remove("opacity-50", "cursor-not-allowed");
  }
}


// =======================
// Success Modal
// =======================
function showPaymentModal(message) {
  const modal = document.createElement("div");
  modal.className =
    "fixed inset-0 bg-black/50 flex items-center justify-center z-50";
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
qs("#paymentForm").addEventListener("submit", async e => {
  e.preventDefault();

  const items = getCartItems();
  if (!items.length) return alert("Cart is empty");

  const { data: { session }, error } = await client.auth.getSession();
  if (error || !session) return alert("Please login first");

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

  try {
    payBtn.disabled = true;
    payBtn.textContent = "Processing...";

    const subtotal = items.reduce(
      (s, it) => s + it.price * it.qty,
      0
    );
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

    localStorage.removeItem("ys_cart_v1");
    if (window.cartAPI) window.cartAPI.clear();

    showPaymentModal("Thank you! Your order is confirmed. Please check your email for order details.");

  } catch (err) {
    console.error(err);
    alert("Payment failed. Please try again.");
  } finally {
    payBtn.disabled = false;
    payBtn.textContent = "Pay Now";
  }
});

// =======================
// Init
// =======================
renderOrderSummary();
setupPaymentTabs();
setupEwalletSelection();
