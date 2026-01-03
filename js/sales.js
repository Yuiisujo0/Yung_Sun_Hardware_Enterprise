// js/sales.js
// Assumes window.supabaseClient is initialized (via js/supabase.js)

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
   Only run when views are not available or when we need detailed orders
========================= */
async function fetchOrdersClient(days = 7) {
  if (!window.supabaseClient) throw new Error('Supabase client not initialized');
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - days);

  // Fetch products first to map categories
  const { data: products, error: productsErr } = await window.supabaseClient
    .from('products')
    .select('id, category');

  if (productsErr) {
    console.error('productsErr', productsErr);
    return [];
  }
  const productMapById = {};
  (products || []).forEach(p => productMapById[String(p.id)] = p);

  // Fetch orders + items
  const { data: orders, error: ordersErr } = await window.supabaseClient
    .from('orders')
    .select('*, order_items(*)')
    .gte('created_at', fromDate.toISOString())
    .order('created_at', { ascending: true });

  if (ordersErr) {
    console.error('ordersErr', ordersErr);
    return [];
  }

  return (orders || []).map(o => ({
    ...o,
    items: (o.order_items || []).map(i => ({
      ...i,
      category: productMapById[String(i.product_id)]?.category || 'N/A'
    }))
  }));
}

/* =========================
   LOAD SALES REPORT
   Approach (best practice):
   - Try server-side aggregated views first (fast, small payload)
     - sales_by_date_view expected columns: day, total, order_count
     - top_selling_products_view expected columns: order_day, product_id, name, category, qty, revenue
   - If either view is missing or empty, fetch orders client-side and compute missing pieces
========================= */
let salesChart = null;

async function loadSalesReport() {
  const days = dateFilter ? Number(dateFilter.value || 7) : 7;

  // containers
  let salesByDate = {};            // { 'YYYY-MM-DD': total }
  let orderCountByDate = {};       // { 'YYYY-MM-DD': order_count } - from view if available
  let topProducts = [];            // array of { name, category, qty, revenue }
  let orders = [];                 // only fetched if needed (client-side)

  const fromIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  // 1) Try server-side sales_by_date_view
  let salesViewAvailable = false;
  try {
    const { data: salesView, error: salesErr } = await window.supabaseClient
      .from('sales_by_date_view')
      .select('*')
      .gte('day', fromIso)
      .order('day', { ascending: true });

    if (!salesErr && salesView && salesView.length) {
      salesViewAvailable = true;
      salesView.forEach(r => {
        const key = formatDateKey(r.day);
        salesByDate[key] = Number(r.total) || 0;
        orderCountByDate[key] = Number(r.order_count) || 0;
      });
    }
  } catch (err) {
    console.warn('sales_by_date_view not available or failed:', err);
  }

  // 2) Try server-side top_selling_products_view
  let topViewAvailable = false;
  try {
    const { data: topView, error: topErr } = await window.supabaseClient
      .from('top_selling_products_view')
      .select('*')
      .gte('order_day', fromIso)
      .order('qty', { ascending: false })
      .limit(10);

    if (!topErr && topView && topView.length) {
      topViewAvailable = true;
      // Aggregate view rows across days into overall top products (sum qty & revenue by name)
      const agg = {};
      (topView || []).forEach(r => {
        const key = r.name || r.product_id || 'Unknown';
        if (!agg[key]) agg[key] = { name: r.name, category: r.category || 'N/A', qty: 0, revenue: 0 };
        agg[key].qty += Number(r.qty || 0);
        agg[key].revenue += Number(r.revenue || 0);
      });
      topProducts = Object.values(agg)
        .sort((a, b) => b.qty - a.qty)
        .slice(0, 10);
    }
  } catch (err) {
    console.warn('top_selling_products_view not available or failed:', err);
  }

  // 3) If either view is missing or returned no rows, fetch client-side orders and compute missing pieces
  if (!salesViewAvailable || !topViewAvailable) {
    orders = await fetchOrdersClient(days);

    // If salesByDate still empty (no view), compute salesByDate and orderCountByDate from orders
    if (!salesViewAvailable) {
      salesByDate = {};
      orderCountByDate = {};
      orders.forEach(o => {
        const key = formatDateKey(o.created_at);
        salesByDate[key] = (salesByDate[key] || 0) + Number(o.total_amount || 0);
        orderCountByDate[key] = (orderCountByDate[key] || 0) + 1;
      });
    }

    // If topProducts not available from view, compute from orders
    if (!topViewAvailable) {
      const productAgg = {};
      orders.forEach(o => {
        (o.items || []).forEach(i => {
          const key = i.name || i.product_id || 'Unknown';
          if (!productAgg[key]) productAgg[key] = { name: i.name, category: i.category || 'N/A', qty: 0, revenue: 0 };
          productAgg[key].qty += Number(i.qty || 0);
          productAgg[key].revenue += Number(i.qty || 0) * Number(i.price || 0);
        });
      });
      topProducts = Object.values(productAgg).sort((a, b) => b.qty - a.qty).slice(0, 10);
    }
  }

  // 4) Prepare chart data (chronological)
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

  // 5) Render Top Products Table
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
          <td class="p-2 sm:p-4 text-center font-medium">${p.qty}</td>
          <td class="p-2 sm:p-4 text-center font-semibold">RM${Number(p.revenue).toFixed(2)}</td>
        `;
        topProductsTable.appendChild(tr);
      });
    }
  }

  // 6) Render Sales By Date Table
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
        // Prefer orderCount from view-based orderCountByDate, otherwise compute from client orders
        let orderCount = '-';
        if (orderCountByDate && orderCountByDate[date] != null) {
          orderCount = orderCountByDate[date];
        } else if (orders && orders.length) {
          orderCount = orders.filter(o => formatDateKey(o.created_at) === date).length;
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
   Export to PDF (optional)
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