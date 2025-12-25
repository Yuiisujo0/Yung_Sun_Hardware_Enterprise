const dateFilter = document.getElementById('dateFilter');

/* =========================
   FETCH ORDERS WITH CATEGORY
========================= */
async function fetchOrders(days = 7) {
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - days);

  // Fetch products first
  const { data: products, error: productsErr } = await supabaseClient
    .from('products')
    .select('id, category');

  if (productsErr) {
    console.error(productsErr);
    return [];
  }

  const productMapById = {};
  products.forEach(p => productMapById[p.id] = p);

  // Fetch orders + items
  const { data: orders, error: ordersErr } = await supabaseClient
    .from('orders')
    .select('*, order_items(*)')
    .gte('created_at', fromDate.toISOString())
    .order('created_at', { ascending: true });

  if (ordersErr) {
    console.error(ordersErr);
    return [];
  }

  return orders.map(o => ({
    ...o,
    items: (o.order_items || []).map(i => ({
      ...i,
      category: productMapById[i.product_id]?.category || 'N/A'
    }))
  }));
}

/* =========================
   LOAD SALES REPORT
========================= */
async function loadSalesReport() {
  const days = Number(dateFilter.value);
  const orders = await fetchOrders(days);

  // Sales Trend
  const salesByDate = {};
  orders.forEach(o => {
    const date = new Date(o.created_at).toLocaleDateString();
    salesByDate[date] = (salesByDate[date] || 0) + Number(o.total_amount);
  });

  new Chart(document.getElementById('salesTrendChart'), {
    type: 'line',
    data: {
      labels: Object.keys(salesByDate),
      datasets: [{
        label: 'Sales (RM)',
        data: Object.values(salesByDate),
        borderColor: '#023f88',
        backgroundColor: 'rgba(2,63,136,0.15)',
        fill: true,
        tension: 0.4
      }]
    },
    options: { plugins: { legend: { display: false } } }
  });

  // Top Selling Products
  const productMap = {};
  orders.forEach(o => {
    o.items.forEach(i => {
      if (!productMap[i.name]) productMap[i.name] = { ...i, qty: 0, revenue: 0 };
      productMap[i.name].qty += Number(i.qty);
      productMap[i.name].revenue += Number(i.qty) * Number(i.price);
    });
  });

  const topProducts = Object.values(productMap).sort((a,b) => b.qty - a.qty).slice(0, 10);
  const topProductsTable = document.getElementById('topProductsTable');
  topProductsTable.innerHTML = '';
  topProducts.forEach(p => {
    const tr = document.createElement('tr');
    tr.className = 'border-t hover:bg-gray-50';
    tr.innerHTML = `
      <td class="p-2 sm:p-4">${p.name}</td>
      <td class="p-2 sm:p-4">${p.category}</td>
      <td class="p-2 sm:p-4 text-center font-medium">${p.qty}</td>
      <td class="p-2 sm:p-4 text-center font-semibold">RM${p.revenue.toFixed(2)}</td>
    `;
    topProductsTable.appendChild(tr);
  });

  // Sales by Date
  const salesByDateTable = document.getElementById('salesByDateTable');
  salesByDateTable.innerHTML = '';
  for (const [date, total] of Object.entries(salesByDate)) {
    const orderCount = orders.filter(
      o => new Date(o.created_at).toLocaleDateString() === date
    ).length;

    const tr = document.createElement('tr');
    tr.className = 'border-t hover:bg-gray-50';
    tr.innerHTML = `
      <td class="p-2 sm:p-4 text-center">${date}</td>
      <td class="p-2 sm:p-4 text-center font-medium">${orderCount}</td>
      <td class="p-2 sm:p-4 text-center font-semibold">RM${total.toFixed(2)}</td>
    `;
    salesByDateTable.appendChild(tr);
  }
}

/* =========================
   EVENT LISTENERS
========================= */
dateFilter.addEventListener('change', loadSalesReport);
loadSalesReport();

/* =========================
   export functions
========================= */
exportBtn.addEventListener('click', async () => {
  const exportArea = document.getElementById('exportArea');

  // Expand scrollable tables temporarily
  const scrollableTables = exportArea.querySelectorAll('tbody');
  scrollableTables.forEach(tbody => {
    tbody.style.maxHeight = 'none';
    tbody.style.overflowY = 'visible';
    tbody.style.display = 'table-row-group'; // ensure block tbody works
  });

  // Capture PDF
  const canvas = await html2canvas(exportArea, { scale: 2 });
  const imgData = canvas.toDataURL('image/png');
  const pdf = new jspdf.jsPDF('p', 'mm', 'a4');
  const imgProps = pdf.getImageProperties(imgData);
  const pdfWidth = pdf.internal.pageSize.getWidth();
  const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;

  pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
  pdf.save(`Sales_Report_${new Date().toLocaleDateString()}.pdf`);

  // Restore scrollable tables
  scrollableTables.forEach(tbody => {
    tbody.style.maxHeight = '20rem'; // same as Tailwind max-h-80
    tbody.style.overflowY = 'auto';
    tbody.style.display = 'block';
  });
});

