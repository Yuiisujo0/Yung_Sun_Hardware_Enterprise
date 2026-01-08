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
const addButton = document.getElementById('addProductBtn'); // your Add button

let editingId = null;
let isReady = false; // auth/storage ready

// ---------- ADMIN GUARD ----------
/*Checks if user is logged in*/
/*Checks user role from profiles table*/
async function requireAdmin() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  /*Not logged in → signin.html*/
  if (!session) return location.href = "signin.html";

  const { data } = await supabaseClient
    .from('profiles')
    .select('role')
    .eq('user_id', session.user.id)
    .single();

  /*Not admin → index.html*/  
  if (data?.role !== 'admin') location.href = "index.html";

  // Prepares database & storage by warming up storage & dummy DB query
  try { 
    await supabaseClient.storage.from('Product Images').list('', { limit: 1 });
    await supabaseClient.from('products').select('id').limit(1);
  } catch(e) { console.log("Warm-up failed", e); }

  isReady = true;
  enableButtons();
  loadInventory();
}
requireAdmin();

function enableButtons() {
  if (addButton) addButton.disabled = false;
  document.querySelectorAll('.btn-edit, .btn-delete').forEach(b => b.disabled = false);
}

// ---------- FETCH & DISPLAY ----------
async function loadInventory(limit = 50) {
  const { data, error } = await supabaseClient
    .from('products')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

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
      <td class="p-4 text-center ${p.stock <= 5 ? 'text-red-600 font-bold' : ''}">${p.stock}</td>
      <td class="p-4 text-center space-x-2">
        <button onclick="openEditModal('${p.id}')" class="text-blue-600 btn-edit">
          <i class="bx bx-edit text-xl"></i>
        </button>
        <button onclick="deleteProduct('${p.id}')" class="text-red-600 btn-delete">
          <i class="bx bx-trash text-xl"></i>
        </button>
      </td>
    `;
    inventoryTable.appendChild(tr);
  });
}

// ---------- IMAGE RESIZE & UPLOAD ----------
async function resizeImage(file, maxWidth = 800, maxHeight = 800, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = e => img.src = e.target.result;
    reader.onerror = reject;
    img.onload = () => {
      let { width, height } = img;
      if (width > height && width > maxWidth) { height *= maxWidth/width; width=maxWidth; }
      if (height >= width && height > maxHeight) { width *= maxHeight/height; height=maxHeight; }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      canvas.toBlob(blob => resolve(new File([blob], file.name, { type: file.type })), file.type, quality);
    };
    reader.readAsDataURL(file);
  });
}

async function uploadImage(file) {
  if (!file) return null;
  const resizedFile = await resizeImage(file);
  const fileExt = resizedFile.name.split('.').pop();
  const fileName = `${Date.now()}.${fileExt}`;
  const filePath = `products/${fileName}`;
  const { error } = await supabaseClient.storage
    .from('Product Images')
    .upload(filePath, resizedFile, { cacheControl: '3600', upsert: false });
  if (error) throw error;
  const { data } = supabaseClient.storage
    .from('Product Images')
    .getPublicUrl(filePath);
  return data.publicUrl;
}

// ---------- MODALS ----------
function openAddModal() { addName.value=addCategory.value=addDescription.value=addPrice.value=addStock.value=addImage.value=''; addModal.classList.remove('hidden'); }
function closeAddModal() { addModal.classList.add('hidden'); }
function openEditModal(id) { fetchProduct(id); }
function closeEditModal() { editModal.classList.add('hidden'); }

// ---------- SAVE ADD ----------
window.saveAddProduct = async function() {
  if (!isReady) { alert("Please wait until the page is fully loaded"); return; }
  try {
    let file = addImage.files[0];
    const payload = {
      name: addName.value.trim(),
      category: addCategory.value.trim(),
      description: addDescription.value.trim(),
      price: Number(addPrice.value),
      stock: Number(addStock.value),
      image_url: file ? 'https://via.placeholder.com/60' : null
    };
    if (!payload.name || !payload.price) { alert('Name and price are required'); return; }
    const { data: inserted, error: insertError } = await supabaseClient
      .from('products')
      .insert(payload)
      .select()
      .single();
    if (insertError) throw insertError;
    showNotification("Product added successfully!");
    loadInventory();
    closeAddModal();
    if (file) {
      const imageUrl = await uploadImage(file);
      await supabaseClient.from('products').update({ image_url: imageUrl }).eq('id', inserted.id);
      loadInventory();
    }
  } catch (error) { console.error(error); alert("Failed to add product"); }
}

// ---------- SAVE EDIT ----------
async function saveEditProduct() {
  if (!isReady) { alert("Please wait until the page is fully loaded"); return; }
  try {
    let file = editImage.files[0];
    let imageUrl = editImage.dataset.current || null;
    const payload = {
      name: editName.value.trim(),
      category: editCategory.value.trim(),
      description: editDescription.value.trim(),
      price: Number(editPrice.value),
      stock: Number(editStock.value),
      image_url: file ? 'https://via.placeholder.com/60' : imageUrl
    };
    await supabaseClient.from('products').update(payload).eq('id', editingId);
    showNotification("Product updated successfully!");
    loadInventory();
    closeEditModal();
    if (file) {
      const newUrl = await uploadImage(file);
      await supabaseClient.from('products').update({ image_url: newUrl }).eq('id', editingId);
      loadInventory();
    }
  } catch (error) { console.error(error); alert("Failed to update product"); }
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
  editImage.value = '';
  editImage.dataset.current = data.image_url || '';
  editModal.classList.remove('hidden');
}

// ---------- DELETE ----------
async function deleteProduct(id) {
  if (!isReady) { alert("Please wait until the page is fully loaded"); return; }
  const confirmed = window.confirm("Are you sure you want to delete this product?");
  if (!confirmed) return;
  try {
    await supabaseClient.from('products').delete().eq('id', id);
    loadInventory();
    showNotification("Product deleted successfully!", 5000, "success");
  } catch (error) {
    console.error("Failed to delete product:", error);
    showNotification("Error deleting product: " + error.message, 5000, "error");
  }
}

// ---------- NOTIFICATION ----------
function showNotification(message="Update successful!", duration=5000, type="success") {
  const notification = document.getElementById('notification');
  if (!notification) return;
  notification.textContent = message;
  notification.className = `fixed bottom-6 right-6 text-white px-4 py-2 rounded shadow-lg z-50 transition-opacity duration-300`;
  if (type==="success") notification.classList.add("bg-green-600");
  if (type==="error") notification.classList.add("bg-red-600");
  if (type==="warning") notification.classList.add("bg-yellow-600");
  notification.classList.remove("hidden");
  notification.classList.add("opacity-100");
  setTimeout(() => {
    notification.classList.remove("opacity-100");
    setTimeout(()=>notification.classList.add("hidden"), 300);
  }, duration);
}
