// Assumes window.supabaseClient is initialized (via js/supabase.js)
// Rewritten to be consistent and accurate:
// - Top Selling Products: always uses the all-time aggregated view `top_selling_products_full_view` (no date filter).
//   If that view is missing, falls back to server-side aggregation via all orders (may be heavy).
// - Sales Trend / Sales by Date: uses `sales_by_date_view` filtered by the selected duration. If missing, falls back
//   to client-side aggregation using orders in the selected range.
// - All numeric conversions are explicit, aggregation keyed by product_id (stable).
// - Robust fallbacks and clear console warnings for visibility.

const dateFilter = document.getElementById('dateFilter');
const exportBtn = document.getElementById('exportBtn'); // optional, may be null

function formatDateKey(d) {
  // returns YYYY-MM-DD for consistent grouping/sorting
  const dt = new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/* =========================
   FETCH ORDERS WITH CATEGORY (client-side fallback)
   days: number -> last N days
   days: null   -> no date filter (all time)
========================= */
async function fetchOrdersClient(days = 7) {
  if (!window.supabaseClient) throw new Error('Supabase client not initialized');

  // Build date filter if days provided
  let fromIso = null;
  if (typeof days === 'number') {
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - days);
    fromDate.setHours(0, 0, 0, 0); // start of day
    fromIso = fromDate.toISOString();
  }

  // Fetch product metadata for category/name lookups
  const { data: products, error: productsErr } = await window.supabaseClient
    .from('products')
    .select('id, name, category');

  if (productsErr) {
    console.error('fetchOrdersClient: productsErr', productsErr);
    // proceed with empty map
  }
  const productMapById = {};
  (products || []).forEach(p => productMapById[String(p.id)] = p);

  // Fetch orders and their items
  let q = window.supabaseClient
    .from('orders')
    .select('id, total_amount, created_at, status, order_items(*)')
    .order('created_at', { ascending: true });

  if (fromIso) q = q.gte('created_at', fromIso);

  const { data: orders, error: ordersErr } = await q;

  if (ordersErr) {
    console.error('fetchOrdersClient: ordersErr', ordersErr);
    return [];
  }

  // Normalize results, attach category by product_id (if available)
  return (orders || []).map(o => ({
    id: o.id,
    total_amount: Number(o.total_amount || 0),
    created_at: o.created_at,
    status: o.status,
    items: (o.order_items || []).map(i => ({
      id: i.id,
      order_id: i.order_id,
      product_id: String(i.product_id),
      name: i.name,
      price: Number(i.price || 0),
      qty: Number(i.qty || 0),
      category: productMapById[String(i.product_id)]?.category || 'N/A'
    }))
  }));
}

/* =========================
   LOAD SALES REPORT
========================= */
let salesChart = null;

async function loadSalesReport() {
  const days = dateFilter ? Number(dateFilter.value || 7) : 7;

  // Results containers
  let salesByDate = {};            // { 'YYYY-MM-DD': total }
  let orderCountByDate = {};       // { 'YYYY-MM-DD': order_count }
  let topProducts = [];            // array of { product_id, name, category, qty, revenue }
  let ordersForRange = [];         // orders fetched for the date range (fallback)
  let ordersAllTime = [];         // orders fetched for all-time (fallback for top products)

  // Prepare from-date ISO (start of day) for sales_by_date queries
  const fromDateForRange = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  fromDateForRange.setHours(0, 0, 0, 0);
  const fromIsoForRange = fromDateForRange.toISOString();

  // 1) Try server-side sales_by_date_view (filtered by range)
  let salesViewAvailable = false;
  try {
    const { data: salesView, error: salesErr } = await window.supabaseClient
      .from('sales_by_date_view')
      .select('day, total, order_count')
      .gte('day', fromIsoForRange)
      .order('day', { ascending: true });

    if (!salesErr && salesView && salesView.length) {
      salesViewAvailable = true;
      salesView.forEach(r => {
        // r.day may be a Date string or timestamp; format to YYYY-MM-DD
        const key = formatDateKey(r.day);
        salesByDate[key] = Number(r.total || 0);
        orderCountByDate[key] = Number(r.order_count || 0);
      });
    }
  } catch (err) {
    console.warn('sales_by_date_view not available or failed:', err);
  }

  // 2) Try server-side all-time top-selling aggregated view
  let topViewAvailable = false;
  try {
    const { data: topView, error: topErr } = await window.supabaseClient
      .from('top_selling_products_full_view') // all-time aggregated view (your schema)
      .select('id, name, category, total_qty_sold, total_revenue')
      .order('total_qty_sold', { ascending: false })
      .limit(10); // safe because view is already aggregated

    if (!topErr && topView && topView.length) {
      topViewAvailable = true;
      topProducts = (topView || []).map(r => ({
        product_id: r.id ?? null,
        name: r.name ?? 'Unknown',
        category: r.category ?? 'N/A',
        qty: Number(r.total_qty_sold || 0),
        revenue: Number(r.total_revenue || 0)
      }));
    }
  } catch (err) {
    console.warn('top_selling_products_full_view not available or failed:', err);
  }

  // 3) Fallbacks: fetch orders as needed
  // If sales_by_date_view missing => need orders for the selected range
  if (!salesViewAvailable) {
    try {
      ordersForRange = await fetchOrdersClient(days);
      // use only paid orders for sales/aggregation
      const paidOrders = ordersForRange.filter(o => String(o.status).toLowerCase() === 'paid');

      salesByDate = {};
      orderCountByDate = {};
      paidOrders.forEach(o => {
        const key = formatDateKey(o.created_at);
        salesByDate[key] = (salesByDate[key] || 0) + Number(o.total_amount || 0);
        orderCountByDate[key] = (orderCountByDate[key] || 0) + 1;
      });
    } catch (err) {
      console.error('Failed to fetch orders for range fallback', err);
    }
  }

  // If top view missing => need all-time aggregation from orders
  if (!topViewAvailable) {
    try {
      // fetch all orders (no date filter) to compute all-time top products
      ordersAllTime = await fetchOrdersClient(null); // null => all time
      const paidAll = ordersAllTime.filter(o => String(o.status).toLowerCase() === 'paid');

      const productAgg = {};
      paidAll.forEach(o => {
        (o.items || []).forEach(i => {
          const key = String(i.product_id || i.name || 'unknown');
          if (!productAgg[key]) productAgg[key] = {
            product_id: i.product_id || null,
            name: i.name || 'Unknown',
            category: i.category || 'N/A',
            qty: 0,
            revenue: 0
          };
          productAgg[key].qty += Number(i.qty || 0);
          productAgg[key].revenue += Number(i.qty || 0) * Number(i.price || 0);
        });
      });

      topProducts = Object.values(productAgg)
        .sort((a, b) => b.qty - a.qty)
        .slice(0, 10);
    } catch (err) {
      console.error('Failed to compute top products from orders', err);
    }
  }

  // 4) Prepare chart data (chronological) from salesByDate (whether from view or fallback)
  const dateLabels = Object.keys(salesByDate).sort((a, b) => new Date(a) - new Date(b));
  const dateValues = dateLabels.map(k => Number(salesByDate[k] || 0));

  // Render Chart.js line chart
  const ctx = document.getElementById('salesTrendChart');
  if (ctx) {
    if (salesChart) {
      salesChart.data.labels = dateLabels;
      salesChart.data.datasets[0].data = dateValues;
      salesChart.update();
    } else {
      salesChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: dateLabels,
          datasets: [{
            label: 'Sales (RM)',
            data: dateValues,
            borderColor: '#023f88',
            backgroundColor: 'rgba(2,63,136,0.15)',
            fill: true,
            tension: 0.4
          }]
        },
        options: {
          plugins: { legend: { display: false } },
          scales: {
            x: { ticks: { maxRotation: 0, autoSkip: true } },
            y: { beginAtZero: true }
          }
        }
      });
    }
  } else {
    console.warn('salesTrendChart canvas not found');
  }

  // 5) Render Top Products Table (all-time)
  const topProductsTable = document.getElementById('topProductsTable');
  if (topProductsTable) {
    topProductsTable.innerHTML = '';
    if (!topProducts || topProducts.length === 0) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td class="p-4 text-center text-gray-500" colspan="4">No product sales data</td>';
      topProductsTable.appendChild(tr);
    } else {
      topProducts.forEach(p => {
        const tr = document.createElement('tr');
        tr.className = 'border-t hover:bg-gray-50';
        tr.innerHTML = `
          <td class="p-2 sm:p-4">${escapeHtml(p.name)}</td>
          <td class="p-2 sm:p-4">${escapeHtml(p.category || 'N/A')}</td>
          <td class="p-2 sm:p-4 text-center font-medium">${Number(p.qty || 0)}</td>
          <td class="p-2 sm:p-4 text-center font-semibold">RM${Number(p.revenue || 0).toFixed(2)}</td>
        `;
        topProductsTable.appendChild(tr);
      });
    }
  }

  // 6) Render Sales By Date Table (range)
  const salesByDateTable = document.getElementById('salesByDateTable');
  if (salesByDateTable) {
    salesByDateTable.innerHTML = '';
    if (!dateLabels || dateLabels.length === 0) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td class="p-4 text-center text-gray-500" colspan="3">No sales in selected range</td>';
      salesByDateTable.appendChild(tr);
    } else {
      dateLabels.forEach(date => {
        const total = Number(salesByDate[date] || 0);
        // Prefer orderCount from view-based orderCountByDate, otherwise compute from fetched ordersForRange
        let orderCount = '-';
        if (orderCountByDate && orderCountByDate[date] != null) {
          orderCount = orderCountByDate[date];
        } else if (ordersForRange && ordersForRange.length) {
          orderCount = ordersForRange.filter(o => formatDateKey(o.created_at) === date && String(o.status).toLowerCase() === 'paid').length;
        }

        const tr = document.createElement('tr');
        tr.className = 'border-t hover:bg-gray-50';
        tr.innerHTML = `
          <td class="p-2 sm:p-4 text-center">${date}</td>
          <td class="p-2 sm:p-4 text-center font-medium">${orderCount}</td>
          <td class="p-2 sm:p-4 text-center font-semibold">RM${total.toFixed(2)}</td>
        `;
        salesByDateTable.appendChild(tr);
      });
    }
  }
} // end loadSalesReport

/* Helper: simple html escape */
function escapeHtml(s) {
  if (!s && s !== 0) return '';
  return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"':'&quot;', "'":'&#39;' })[m]);
}

/* =========================
   EVENT LISTENERS
========================= */
if (dateFilter) dateFilter.addEventListener('change', loadSalesReport);
loadSalesReport();

/* =========================
   Export to PDF (optional) -- unchanged
========================= */
if (exportBtn) {
  exportBtn.addEventListener('click', async () => {
    const exportArea = document.getElementById('exportArea');
    if (!exportArea) return alert('Export area not found');

    // Temporarily expand tables for capture
    const scrollableTables = exportArea.querySelectorAll('tbody');
    scrollableTables.forEach(tbody => {
      tbody.style.maxHeight = 'none';
      tbody.style.overflowY = 'visible';
      tbody.style.display = 'table-row-group';
    });

    try {
      const canvas = await html2canvas(exportArea, { scale: 2 });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jspdf.jsPDF('p', 'mm', 'a4');
      const imgProps = pdf.getImageProperties(imgData);
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
      pdf.save(`Sales_Report_${new Date().toISOString().slice(0,10)}.pdf`);
    } catch (err) {
      console.error('Export failed', err);
      alert('Export failed, see console for details');
    } finally {
      // Restore styles
      scrollableTables.forEach(tbody => {
        tbody.style.maxHeight = '20rem';
        tbody.style.overflowY = 'auto';
        tbody.style.display = 'block';
      });
    }
  });
}