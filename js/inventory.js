// ---------- Select Modal Elements ----------
const addModal = document.getElementById('addProductModal');
const editModal = document.getElementById('editProductModal');

const addName = document.getElementById('addProductName');
const addCategory = document.getElementById('addProductCategory');
const addDescription = document.getElementById('addProductDescription');
const addPrice = document.getElementById('addProductPrice');
const addStock = document.getElementById('addProductStock');
const addImage = document.getElementById('addProductImage');

const editName = document.getElementById('editProductName');
const editCategory = document.getElementById('editProductCategory');
const editDescription = document.getElementById('editProductDescription');
const editPrice = document.getElementById('editProductPrice');
const editStock = document.getElementById('editProductStock');
const editImage = document.getElementById('editProductImage');

const inventoryTable = document.getElementById('inventoryTable');
const notification = document.getElementById('notification');

let editingId = null;

// ---------- ADMIN GUARD ----------
async function requireAdmin() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) return location.href = "signin.html";

  const { data } = await supabaseClient
    .from('profiles')
    .select('role')
    .eq('user_id', session.user.id)
    .single();

  if (data?.role !== 'admin') location.href = "index.html";

  loadInventory();
}
requireAdmin();

// ---------- FETCH & DISPLAY ----------
async function loadInventory() {
  const { data, error } = await supabaseClient
    .from('products')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return console.error(error);

  inventoryTable.innerHTML = '';

  data.forEach(p => {
    const tr = document.createElement('tr');
    tr.className = 'border-t hover:bg-gray-50 align-middle';

    tr.innerHTML = `
      <td class="p-4">
        <div class="flex items-center gap-3">
          <img src="${p.image_url || 'https://via.placeholder.com/60'}" class="w-14 h-14 rounded-lg object-contain border"/>
          <p class="font-semibold">${p.name}</p>
        </div>
      </td>
      <td class="p-4 text-gray-600 max-w-[300px]">
        <p class="line-clamp-2">${p.description || '-'}</p>
      </td>
      <td class="p-4 text-center">${p.category || '-'}</td>
      <td class="p-4 text-center">RM ${Number(p.price).toFixed(2)}</td>
      <td class="p-4 text-center ${p.stock < 5 ? 'text-red-600 font-bold' : ''}">${p.stock}</td>
      <td class="p-4 text-center space-x-2">
        <button onclick="openEditModal('${p.id}')" class="text-blue-600">
          <i class="bx bx-edit text-xl"></i>
        </button>
        <button onclick="deleteProduct('${p.id}')" class="text-red-600">
          <i class="bx bx-trash text-xl"></i>
        </button>
      </td>
    `;
    inventoryTable.appendChild(tr);
  });
}

// ---------- MODALS ----------
function openAddModal() {
  addName.value = '';
  addCategory.value = '';
  addDescription.value = '';
  addPrice.value = '';
  addStock.value = '';
  addImage.value = '';
  addModal.classList.remove('hidden');
}
function closeAddModal() { addModal.classList.add('hidden'); }

function openEditModal(id) {
  fetchProduct(id);
}
function closeEditModal() { editModal.classList.add('hidden'); }

// ---------- SAVE ADD ----------
async function saveAddProduct() {
  const payload = {
    name: addName.value.trim(),
    category: addCategory.value.trim(),
    description: addDescription.value.trim(),
    price: Number(addPrice.value),
    stock: Number(addStock.value),
    image_url: addImage.value.trim()
  };
  if (!payload.name || !payload.price) { alert('Name and price are required'); return; }

  try {
    await supabaseClient.from('products').insert(payload);
    showNotification("Product added successfully!");
    loadInventory();
    closeAddModal();
  } catch (error) {
    console.error('Failed to add product:', error);
    alert('Error adding product: ' + error.message);
  }
}

// ---------- SAVE EDIT ----------
async function saveEditProduct() {
  const payload = {
    name: editName.value.trim(),
    category: editCategory.value.trim(),
    description: editDescription.value.trim(),
    price: Number(editPrice.value),
    stock: Number(editStock.value),
    image_url: editImage.value.trim()
  };
  if (!payload.name || !payload.price) { alert('Name and price are required'); return; }

  try {
    await supabaseClient.from('products').update(payload).eq('id', editingId);
    showNotification("Product updated successfully!");
    loadInventory();
    closeEditModal();
  } catch (error) {
    console.error('Failed to update product:', error);
    alert('Error updating product: ' + error.message);
  }
}

// ---------- FETCH PRODUCT FOR EDIT ----------
async function fetchProduct(id) {
  const { data, error } = await supabaseClient.from('products').select('*').eq('id', id).single();
  if (error || !data) { alert('Failed to load product'); return; }

  editingId = data.id;
  editName.value = data.name || '';
  editCategory.value = data.category || '';
  editDescription.value = data.description || '';
  editPrice.value = data.price || '';
  editStock.value = data.stock || '';
  editImage.value = data.image_url || '';

  editModal.classList.remove('hidden');
}

// ---------- DELETE ----------
async function deleteProduct(id) {
  const confirmed = window.confirm("Are you sure you want to delete this product?");
  if (!confirmed) return;

  try {
    await supabaseClient.from('products').delete().eq('id', id);
    loadInventory();
    showNotification("Product deleted successfully!", 3000, "success"); // ✅ green bottom-right
  } catch (error) {
    console.error("Failed to delete product:", error);
    showNotification("Error deleting product: " + error.message, 5000, "error"); // red notification
  }
}

// ---------- NOTIFICATION ----------
function showNotification(message = "Update successful!", duration = 3000, type = "success") {
  const notification = document.getElementById('notification');

  if (!notification) return; // safety check

  // Set text
  notification.textContent = message;

  // Reset classes
  notification.className = `fixed bottom-6 right-6 text-white px-4 py-2 rounded shadow-lg z-50 transition-opacity duration-300`;

  // Set color
  if (type === "success") notification.classList.add("bg-green-600");
  if (type === "error") notification.classList.add("bg-red-600");
  if (type === "warning") notification.classList.add("bg-yellow-600");

  // Show notification
  notification.classList.remove("hidden");
  notification.classList.add("opacity-100");

  // Hide after duration
  setTimeout(() => {
    notification.classList.remove("opacity-100");
    setTimeout(() => notification.classList.add("hidden"), 300);
  }, duration);
}



