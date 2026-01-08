// js/admin.js

document.addEventListener("DOMContentLoaded", () => {
  if (!window.supabaseClient) {
    console.error("Supabase client not found");
    return;
  }

  initAdminDashboard();
});

/* ===============================
   SUPABASE CLIENT
================================= */
const db = window.supabaseClient;

/* ===============================
   INITIALIZE DASHBOARD
================================= */
async function initAdminDashboard() {
  try {
    await Promise.all([
      loadStats(),
      loadSalesTrend(),
      loadOrderStatusChart(),
      loadRecentOrders()
    ]);
  } catch (err) {
    console.error("Dashboard initialization error:", err);
  }
}

/* ===============================
   STATS CARDS
================================= */
async function loadStats() {
  /* ---------- ORDERS & SALES ---------- */
  const { data: orders, error: ordersError } = await db
    .from("orders")
    .select("total_amount");

  if (ordersError) {
    console.error("Error loading orders:", ordersError);
    return;
  }

  const totalSales = orders.reduce(
    (sum, order) => sum + Number(order.total_amount),
    0
  );

  document.getElementById("sales").textContent =
    `RM${totalSales.toFixed(2)}`;
  document.getElementById("orders").textContent =
    orders.length;

  /* ---------- PRODUCTS ---------- */
  const { data: products, error: productsError } = await db
    .from("products")
    .select("stock");

  if (productsError) {
    console.error("Error loading products:", productsError);
    return;
  }

  document.getElementById("products").textContent =
    products.length;

  /* ---------- LOW STOCK ---------- */
  const lowStockCount = products.filter(
    product => (product.stock ?? 0) <= 5
  ).length;

  updateLowStockUI(lowStockCount);
}

/* ===============================
   LOW STOCK UI HANDLER
================================= */
function updateLowStockUI(count) {
  const card = document.getElementById("lowStockCard");
  const text = document.getElementById("lowStock");

  if (!card || !text) return;

  if (count > 0) {
    // Low stock exists → red alert
    card.classList.remove("bg-white", "text-primary");
    card.classList.add("bg-lowstock", "text-white");

    text.textContent = count;
  } else {
    // No low stock → normal state
    card.classList.remove("bg-lowstock", "text-white");
    card.classList.add("bg-white", "text-primary");

    text.textContent = "0"; // or "None"
  }
}

/* ===============================
   SALES TREND CHART (LINE)
================================= */
async function loadSalesTrend() {
  const { data, error } = await db
    .from("orders")
    .select("total_amount, created_at")
    .order("created_at");

  if (error) {
    console.error("Sales trend error:", error);
    return;
  }

  const dailySales = {};

  data.forEach(order => {
    const date = new Date(order.created_at)
      .toLocaleDateString("en-MY");

    dailySales[date] =
      (dailySales[date] || 0) + Number(order.total_amount);
  });

  new Chart(document.getElementById("salesChart"), {
    type: "line",
    data: {
      labels: Object.keys(dailySales),
      datasets: [{
        label: "Sales (RM)",
        data: Object.values(dailySales),
        borderWidth: 3,
        tension: 0.4,
        fill: true
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false }
      },
      scales: {
        y: { beginAtZero: true }
      }
    }
  });
}

/* ===============================
   ORDER STATUS CHART (DOUGHNUT)
================================= */
async function loadOrderStatusChart() {
  const { data, error } = await db
    .from("orders")
    .select("status");

  if (error) {
    console.error("Order status error:", error);
    return;
  }

  const statusCount = {};

  data.forEach(order => {
    statusCount[order.status] =
      (statusCount[order.status] || 0) + 1;
  });

  new Chart(document.getElementById("ordersChart"), {
    type: "doughnut",
    data: {
      labels: Object.keys(statusCount),
      datasets: [{
        data: Object.values(statusCount)
      }]
    },
    options: {
      plugins: {
        legend: { position: "bottom" }
      }
    }
  });
}

/* ===============================
   RECENT ORDERS TABLE
================================= */
async function loadRecentOrders() {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const { data, error } = await db
    .from("orders")
    .select("id, full_name, total_amount, status, created_at")
    .gte("created_at", sevenDaysAgo.toISOString())
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Recent orders error:", error);
    return;
  }

  const tbody = document.getElementById("ordersTable");
  tbody.innerHTML = "";

  data.forEach(order => {
    const date = new Date(order.created_at);

    const formattedDate = date.toLocaleDateString("en-MY", {
      day: "2-digit",
      month: "short",
      year: "numeric"
    });

    const formattedTime = date.toLocaleTimeString("en-MY", {
      hour: "2-digit",
      minute: "2-digit"
    });

    tbody.innerHTML += `
      <tr class="divide-x hover:bg-gray-50">
        <td class="p-4 text-sm font-mono text-gray-600 truncate" title="${order.id}">
          ${order.id}
        </td>
        <td class="p-4 w-48 truncate" title="${order.full_name}">
          ${order.full_name}
        </td>
        <td class="p-4 text-center text-gray-500 text-xs">
          ${formattedDate}<br>
          <span class="text-[11px]">${formattedTime}</span>
        </td>
        <td class="p-4 text-right font-semibold">
          ${Number(order.total_amount).toFixed(2)}
        </td>
        <td class="p-4 text-center">
          <span class="px-3 py-1 rounded-full text-xs font-medium
            ${order.status === "completed"
              ? "bg-green-100 text-green-700"
              : order.status === "pending"
              ? "bg-yellow-100 text-yellow-700"
              : "bg-orange-500 text-white"}">
            ${order.status}
          </span>
        </td>
      </tr>
    `;
  });
}
