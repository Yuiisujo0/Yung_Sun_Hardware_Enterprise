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
   - Prefer server-side views for performance
   - Fallback to client-side aggregation if views not present
========================= */
let salesChart = null;

async function loadSalesReport() {
  if (!dateFilter) {
    console.warn('dateFilter element not found');
  }
  const days = dateFilter ? Number(dateFilter.value || 7) : 7;

  // Try server-side view first (recommended). If it fails, fallback to client aggregation.
  let salesByDate = {}; // { 'YYYY-MM-DD': total }
  let orders = [];
  let topProducts = [];

  try {
    // Attempt to query a view called sales_by_date_view which should return (day date, total numeric, order_count int)
    const { data: salesView, error: salesErr } = await window.supabaseClient
      .from('sales_by_date_view')
      .select('*')
      .gte('day', new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString())
      .order('day', { ascending: true });

    if (!salesErr && salesView && salesView.length) {
      // map to salesByDate using view result
      salesView.forEach(r => {
        const key = (r.day instanceof String) ? r.day : formatDateKey(r.day);
        salesByDate[key] = Number(r.total) || 0;
      });
    }
  } catch (err) {
    // view may not exist; ignore and fallback
    console.warn('sales_by_date_view not available, falling back to client aggregation', err);
  }

  try {
    // Try top selling products view
    const { data: topView, error: topErr } = await window.supabaseClient
      .from('top_selling_products_view')
      .select('*')
      .gte('order_day', new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString())
      .order('qty', { ascending: false })
      .limit(10);

    if (!topErr && topView && topView.length) {
      topProducts = topView.map(r => ({
        name: r.name,
        category: r.category,
        qty: Number(r.qty) || 0,
        revenue: Number(r.revenue) || 0
      }));
    }
  } catch (err) {
    console.warn('top_selling_products_view not available, will compute client-side', err);
  }

  // If salesByDate is empty (no view or empty result), compute client-side
  if (Object.keys(salesByDate).length === 0 || topProducts.length === 0) {
    orders = await fetchOrdersClient(days);

    // Sales Trend (client-side)
    salesByDate = {};
    orders.forEach(o => {
      const key = formatDateKey(o.created_at);
      salesByDate[key] = (salesByDate[key] || 0) + Number(o.total_amount || 0);
    });

    // Top Selling Products (client-side)
    const productMap = {};
    orders.forEach(o => {
      (o.items || []).forEach(i => {
        if (!productMap[i.name]) productMap[i.name] = { name: i.name, category: i.category || 'N/A', qty: 0, revenue: 0 };
        productMap[i.name].qty += Number(i.qty || 0);
        productMap[i.name].revenue += Number(i.qty || 0) * Number(i.price || 0);
      });
    });

    topProducts = Object.values(productMap).sort((a, b) => b.qty - a.qty).slice(0, 10);
  }

  // Prepare data for Chart.js - ensure chronological order
  const dateLabels = Object.keys(salesByDate).sort((a, b) => new Date(a) - new Date(b));
  const dateValues = dateLabels.map(k => Number(salesByDate[k] || 0));

  // Render chart
  const ctx = document.getElementById('salesTrendChart');
  if (!ctx) {
    console.warn('salesTrendChart canvas not found');
  } else {
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
  }

  // Render Top Products Table
  const topProductsTable = document.getElementById('topProductsTable');
  if (topProductsTable) {
    topProductsTable.innerHTML = '';
    if (topProducts.length === 0) {
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

  // Render Sales By Date Table
  const salesByDateTable = document.getElementById('salesByDateTable');
  if (salesByDateTable) {
    salesByDateTable.innerHTML = '';
    if (dateLabels.length === 0) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td class="p-4 text-center text-gray-500" colspan="3">No sales in selected range</td>';
      salesByDateTable.appendChild(tr);
    } else {
      dateLabels.forEach(date => {
        const total = Number(salesByDate[date] || 0);
        // orderCount calculate from client orders if available
        let orderCount = 0;
        if (orders && orders.length) {
          orderCount = orders.filter(o => formatDateKey(o.created_at) === date).length;
        } else {
          orderCount = '-';
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
}

/* Helper: simple html escape */
function escapeHtml(s) {
  if (!s) return '';
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