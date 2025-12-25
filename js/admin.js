async function requireAdmin() {
    if (!window.supabaseClient) return;

    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) return window.location.href = "signin.html";

    const { data } = await supabaseClient
    .from('profiles')
    .select('role')
    .eq('user_id', session.user.id)
    .single();

    if (data?.role !== 'admin') {
    return window.location.href = "index.html";
    }

    loadDashboard();
}

requireAdmin();

async function fetchProducts() {
    const { data, error } = await supabaseClient.from('products').select('*');
    if (error) return [];
    return data;
}

async function fetchLowStockProducts() {
    const { data, error } = await supabaseClient.from('products').select('*').lt('stock', 5);
    if (error) return [];
    return data;
}

async function fetchOrders() {
    const { data, error } = await supabaseClient.from('orders').select('*').order('created_at', { ascending: false }).limit(7);
    if (error) return [];
    return data;
}

async function fetchTotalSales() {
    const { data, error } = await supabaseClient
    .from('orders')
    .select('total');
    if (error || !data) return 0;
    return data.reduce((sum, order) => sum + Number(order.total), 0);
}

async function loadDashboard() {
    const products = await fetchProducts();
    const lowStock = await fetchLowStockProducts();
    const orders = await fetchOrders();
    const totalSales = await fetchTotalSales();

    document.getElementById('products').textContent = products.length;
    document.getElementById('lowStock').textContent = lowStock.length;
    document.getElementById('orders').textContent = orders.length;
    document.getElementById('sales').textContent = `RM${totalSales.toFixed(2)}`;

    const table = document.getElementById('ordersTable');
    table.innerHTML = '';
    orders.forEach(o => {
    const tr = document.createElement('tr');
    tr.className = 'border-t hover:bg-gray-50';
    tr.innerHTML = `
        <td class="p-4 font-medium">${o.id}</td>
        <td class="p-4">${o.customer_name || 'N/A'}</td>
        <td class="p-4">$${o.total}</td>
        <td class="p-4 font-semibold ${o.status === 'Completed' ? 'text-green-600' : 'text-accent'}">${o.status}</td>
    `;
    table.appendChild(tr);
    });

    // Example charts
    new Chart(document.getElementById('salesChart'), {
    type: 'line',
    data: {
        labels: orders.map(o => new Date(o.created_at).toLocaleDateString()),
        datasets: [{
        data: orders.map(o => Number(o.total)),
        borderColor: '#023f88',
        backgroundColor: 'rgba(2,63,136,0.15)',
        fill: true,
        tension: 0.4
        }]
    },
    options: { plugins: { legend: { display: false } } }
    });

    const statusCounts = orders.reduce((acc, o) => {
    acc[o.status] = (acc[o.status] || 0) + 1;
    return acc;
    }, {});

    new Chart(document.getElementById('ordersChart'), {
    type: 'doughnut',
    data: {
        labels: Object.keys(statusCounts),
        datasets: [{ data: Object.values(statusCounts), backgroundColor: ['#023f88', '#f8941e', '#d1d5db'] }]
    },
    options: { cutout: '70%' }
    });
}

loadDashboard();
