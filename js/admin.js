// js/admin.js
document.addEventListener("DOMContentLoaded", () => {
  if (!window.supabaseClient) {
    console.error("Supabase client not found");
    return;
  }
  initAdminDashboard();
});

/*Supabase Database Reference*/
const db = window.supabaseClient;

/* ===============================
   INIT (Dashboard Initialization)
================================== */
async function initAdminDashboard() {
  await Promise.all([
    loadStats(),
    loadSalesTrend(),
    loadOrderStatusChart(),
    loadRecentOrders()
  ]);
}

/* =========================
   STATS CARDS
========================= */
async function loadStats() {
  /* ---- ORDERS ---- */
  const { data: orders, error: orderErr } = await db
    .from("orders")
    .select("id, total_amount");

  if (orderErr) {
    console.error(orderErr);
    return;
  }

  /*Calculate total sales*/
  const totalSales = orders.reduce(
    (sum, o) => sum + Number(o.total_amount),
    0
  );

  document.getElementById("sales").innerText =
    `RM${totalSales.toFixed(2)}`;
  document.getElementById("orders").innerText =
    orders.length;

  /* ---- PRODUCTS ---- */
  const { data: products, error: prodErr } = await db
    .from("products")
    .select("stock");

  if (prodErr) {
    console.error(prodErr);
    return;
  }

  document.getElementById("products").innerText =
    products.length;

  /*Low Stock Stats - appear when products <= 5*/  
  const lowStockCount = products.filter(
    p => (p.stock ?? 0) <= 5
  ).length;

  document.getElementById("lowStock").innerText =
    lowStockCount;
}

/* =========================
   SALES TREND (LINE)
========================= */
async function loadSalesTrend() {
  const { data, error } = await db
    .from("orders")
    .select("total_amount, created_at")
    .order("created_at");

  if (error) {
    console.error(error);
    return;
  }

  const dailySales = {};

  data.forEach(o => {
    const date = new Date(o.created_at)
      .toLocaleDateString("en-MY");
    dailySales[date] =
      (dailySales[date] || 0) + Number(o.total_amount);
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
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true } }
    }
  });
}

/* =========================
   ORDER STATUS (DOUGHNUT)
========================= */
async function loadOrderStatusChart() {
  const { data, error } = await db
    .from("orders")
    .select("status");

  if (error) {
    console.error(error);
    return;
  }

  const statusMap = {};
  data.forEach(o => {
    statusMap[o.status] =
      (statusMap[o.status] || 0) + 1;
  });

  new Chart(document.getElementById("ordersChart"), {
    type: "doughnut",
    data: {
      labels: Object.keys(statusMap),
      datasets: [{
        data: Object.values(statusMap)
      }]
    },
    options: {
      plugins: { legend: { position: "bottom" } }
    }
  });
}

/* =========================
   RECENT ORDERS TABLE
========================= */
async function loadRecentOrders() {
  // Calculate date 7 days ago
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const { data, error } = await db
    .from("orders")
    .select("id, full_name, total_amount, status, created_at")
    .gte("created_at", sevenDaysAgo.toISOString()) // filter orders from last 7 days
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    return;
  }

  const tbody = document.getElementById("ordersTable");
  tbody.innerHTML = "";

  data.forEach(o => {
    const date = new Date(o.created_at);
    const formattedDate = date.toLocaleDateString("en-MY", {
      day: "2-digit",
      month: "short",
      year: "numeric"
    });
    const formattedTime = date.toLocaleTimeString("en-MY", {
      hour: "2-digit",
      minute: "2-digit"
    });

    /*Render Orders Table*/
    tbody.innerHTML += `
      <tr class="divide-x hover:bg-gray-50">
        <td class="p-4 text-sm font-mono text-gray-600 truncate" title="${o.id}">${o.id}</td>
        <td class="p-4 w-48 text-base truncate " title="${o.full_name}">${o.full_name}</td>
        <td class="p-4 text-center text-gray-500 text-xs">
          ${formattedDate}<br><span class="text-[11px]">${formattedTime}</span>
        </td>
        <td class="p-4 text-right font-semibold">${Number(o.total_amount).toFixed(2)}</td>
        <td class="p-4 text-center">
          <span class="px-3 py-1 rounded-full text-xs font-medium
            ${o.status === "completed" ? "bg-green-100 text-green-700"
            : o.status === "pending" ? "bg-yellow-100 text-yellow-700"
            : "bg-orange-500 text-white"}">
            ${o.status}
          </span>
        </td>
      </tr>
    `;
  });
}



