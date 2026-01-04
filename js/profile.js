// js/profile.js
// Robust profile page script with default avatar handling, safe DOM checks,
// upsert behavior for profiles table, and improved upload handling.
//
// Assumes js/supabase.js initializes window.supabaseClient and may dispatch 'supabase:ready'.
// This file should be loaded after supabase.js (as in your HTML).

/* Helpers */
function $id(id) { return document.getElementById(id); }
function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }
function escapeHtml(s = '') { return String(s).replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[m]); }

/* Default avatar path used when no avatar_url present or when loading fails */
const DEFAULT_AVATAR = 'assets/default-avatar.webp';

/* Wait for supabase client to exist (short timeout) */
async function waitForSupabase(timeout = 2000) {
  const start = Date.now();
  while (!window.supabaseClient && (Date.now() - start < timeout)) {
    // if your loader dispatches event 'supabase:ready' you may prefer to listen instead
    await sleep(80);
  }
  return !!window.supabaseClient;
}

/* Safe set image src with fallback on error */
function setAvatarSrc(imgEl, src) {
  if (!imgEl) return;
  imgEl.src = src || DEFAULT_AVATAR;
  // ensure fallback if image fails to load (broken url)
  imgEl.onerror = () => {
    imgEl.onerror = null;
    imgEl.src = DEFAULT_AVATAR;
  };
}

/* Main init */
(async function initProfilePage() {
  // Wait for DOM elements to exist
  await Promise.resolve();

  // Wait for supabase client (if not already ready)
  await waitForSupabase();

  const client = window.supabaseClient;
  if (!client) {
    console.error('Supabase client not initialized.');
    // still ensure UI has sensible defaults
    setAvatarSrc($id('userAvatar'), DEFAULT_AVATAR);
    $id('userEmail') && ($id('userEmail').textContent = 'Not signed in');
    return;
  }

  // DOM elements (safely)
  const userAvatar = $id('userAvatar');
  const avatarInput = $id('avatarInput');
  const avatarContainer = document.querySelector('.avatar-container');
  const userEmailEl = $id('userEmail');
  const userNameEl = $id('userName');
  const userPhoneEl = $id('userPhone');
  const userAddressEl = $id('userAddress');
  const logoutBtn = $id('logoutBtn');
  const editBtn = $id('editBtn');

  // Set default avatar immediately to avoid blank image
  setAvatarSrc(userAvatar, DEFAULT_AVATAR);

  // Get session
  let session;
  try {
    const { data, error } = await client.auth.getSession();
    if (error) console.warn('getSession error', error);
    session = data?.session || null;
  } catch (err) {
    console.error('Error getting session:', err);
    session = null;
  }

  if (!session) {
    // Not logged in -> redirect to signin
    return window.location.href = 'signin.html';
  }

  const userId = session.user.id;
  // Set email (always available from session)
  if (userEmailEl) userEmailEl.textContent = session.user.email || '';

  // Load profile row (may not exist)
  let profileRow = null;
  try {
    const { data, error, status } = await client
      .from('profiles')
      .select('user_id, full_name, phone, address, avatar_url, role')
      .eq('user_id', userId)
      .maybeSingle();

    if (error && status !== 406) { // 406 not-found for maybeSingle is okay
      console.warn('profiles select error', error);
    }
    profileRow = data || null;
  } catch (err) {
    console.error('Failed to fetch profile row', err);
  }

  // Populate UI from profile (if available)
  if (profileRow) {
    if (userNameEl) userNameEl.textContent = profileRow.full_name || 'Not set';
    if (userPhoneEl) userPhoneEl.textContent = profileRow.phone || 'Not set';
    if (userAddressEl) userAddressEl.textContent = profileRow.address || 'Not set';

    // Use stored avatar_url if present, otherwise default
    setAvatarSrc(userAvatar, profileRow.avatar_url || DEFAULT_AVATAR);

    // Show admin menu if admin
    if (profileRow.role === 'admin') {
      document.getElementById('adminMenu')?.classList.remove('hidden');
      document.getElementById('adminMenuMobile')?.classList.remove('hidden');
    }
  } else {
    // No profile row: keep defaults and ensure avatar displays default
    if (userNameEl) userNameEl.textContent = 'Not set';
    if (userPhoneEl) userPhoneEl.textContent = 'Not set';
    if (userAddressEl) userAddressEl.textContent = 'Not set';
    setAvatarSrc(userAvatar, DEFAULT_AVATAR);
  }

  // ===== Avatar upload handling =====
  if (avatarContainer && avatarInput && userAvatar) {
    // click container to open file picker
    avatarContainer.addEventListener('click', () => avatarInput.click());

    avatarInput.addEventListener('change', async (ev) => {
      const file = ev.target.files?.[0];
      if (!file) return;

      // Simple client-side validation (optional)
      if (!file.type.startsWith('image/')) {
        return alert('Please select an image file.');
      }

      // Show local preview immediately for better UX (object URL)
      const objectUrl = URL.createObjectURL(file);
      setAvatarSrc(userAvatar, objectUrl);

      try {
        // Prepare path: avatars/<userId>/avatar.<ext>
        const fileExt = file.name.split('.').pop();
        const fileName = `avatar.${fileExt}`;
        const filePath = `${userId}/${fileName}`;

        // Upload to Supabase Storage
        const { data: uploadData, error: uploadError } = await client.storage
          .from('avatars')
          .upload(filePath, file, { upsert: true });

        if (uploadError) {
          // Revoke preview URL and restore previous avatar (profileRow?.avatar_url or default)
          URL.revokeObjectURL(objectUrl);
          setAvatarSrc(userAvatar, profileRow?.avatar_url || DEFAULT_AVATAR);
          throw uploadError;
        }

        // Get public URL for stored file
        const { data: publicData, error: urlError } = client.storage
          .from('avatars')
          .getPublicUrl(filePath);

        if (urlError) {
          URL.revokeObjectURL(objectUrl);
          setAvatarSrc(userAvatar, profileRow?.avatar_url || DEFAULT_AVATAR);
          throw urlError;
        }

        const publicUrl = publicData?.publicUrl || null;
        if (!publicUrl) {
          URL.revokeObjectURL(objectUrl);
          setAvatarSrc(userAvatar, profileRow?.avatar_url || DEFAULT_AVATAR);
          throw new Error('Failed to obtain public URL for uploaded avatar.');
        }

        // Upsert profile row with new avatar_url (creates row if missing)
        const upsertPayload = {
          user_id: userId,
          avatar_url: publicUrl,
          full_name: profileRow?.full_name || null,
          phone: profileRow?.phone || null,
          address: profileRow?.address || null
        };

        const { data: upsertData, error: upsertError } = await client
          .from('profiles')
          .upsert(upsertPayload, { onConflict: 'user_id' });

        if (upsertError) {
          console.warn('Failed upserting profile with avatar_url', upsertError);
          // still keep avatar visually but inform user
          alert('Avatar uploaded but failed to link to profile. Check console.');
        } else {
          profileRow = Array.isArray(upsertData) ? upsertData[0] : upsertData;
        }

        // Set final avatar src to publicUrl (ensure no cached broken image)
        setAvatarSrc(userAvatar, publicUrl);

        // Cleanup preview object URL
        URL.revokeObjectURL(objectUrl);

        console.log('Avatar uploaded and profile updated successfully.');
      } catch (err) {
        console.error('Avatar upload failed:', err);
        alert('Upload failed. See console for details.');
      } finally {
        // Reset input so same file can be selected again if needed
        try { avatarInput.value = ''; } catch {}
      }
    });
  }

  // ===== Logout button =====
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      try {
        await client.auth.signOut();
      } catch (err) {
        console.warn('Sign out error', err);
      } finally {
        // Ensure cart UI reverts to anonymous and clears
        try { window.cartAPI?.useAnonymousAndClear?.(); } catch (e) {}
        window.location.href = 'index.html';
      }
    });
  }

  // ===== Inline editing (upsert on save) =====
  if (editBtn && userNameEl && userPhoneEl && userAddressEl) {
    let isEditing = false;
    const fields = ['userName', 'userPhone', 'userAddress'];

    editBtn.addEventListener('click', async () => {
      isEditing = !isEditing;

      if (isEditing) {
        editBtn.textContent = 'Save';
        // Replace spans with inputs
        fields.forEach(id => {
          const span = $id(id);
          if (!span) return;
          const value = span.textContent === 'Not set' ? '' : span.textContent;
          const input = document.createElement('input');
          input.type = 'text';
          input.value = value;
          input.id = id;
          input.className = id === 'userAddress'
            ? 'border rounded-md px-3 py-2 w-full text-gray-700'
            : 'border rounded-md px-2 py-1 w-64 text-gray-700';
          span.replaceWith(input);
        });
      } else {
        // Save changes: collect values, replace inputs back to spans, upsert profiles
        editBtn.textContent = 'Edit';
        const updated = {};
        fields.forEach(id => {
          const input = $id(id);
          if (!input) return;
          updated[id] = input.value?.trim() || '';
          const span = document.createElement('span');
          span.id = id;
          span.textContent = updated[id] || 'Not set';
          span.className = id === 'userAddress' ? 'break-words w-full max-w-full' : 'truncate max-w-[250px]';
          input.replaceWith(span);
        });

        // Upsert profile row with new values
        try {
          const payload = {
            user_id: userId,
            full_name: updated.userName || null,
            phone: updated.userPhone || null,
            address: updated.userAddress || null,
            avatar_url: profileRow?.avatar_url || null
          };
          const { data: upsertData, error: upsertError } = await client
            .from('profiles')
            .upsert(payload, { onConflict: 'user_id' });

          if (upsertError) throw upsertError;
          profileRow = Array.isArray(upsertData) ? upsertData[0] : upsertData;
          console.log('Profile updated successfully.');
        } catch (err) {
          console.error('Failed to update profile:', err);
          alert('Failed to save changes. See console for details.');
        }
      }
    });
  }

})();