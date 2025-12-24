// profile.js
// Ensure supabase.js is loaded before this file

const client = window.supabaseClient; // use the singleton

(async () => {
    if (!client) {
        console.error('Supabase client not initialized.');
        return;
    }

    // Get session
    const { data: { session }, error: sessionError } = await client.auth.getSession();
    if (sessionError) {
        console.error('Error getting session:', sessionError);
        return;
    }

    if (!session) {
        return window.location.href = 'signin.html';
    }

    const userId = session.user.id;

    // Show user email
    document.getElementById('userEmail').textContent = session.user.email;

    // Load extra info from 'profiles' table
    const { data, error } = await client.from('profiles')
        .select('*')
        .eq('user_id', userId)
        .single();

    if (error) {
        console.error('Error loading profile:', error);
    } else if (data) {
        document.getElementById('userName').textContent = data.full_name || 'Not set';
        document.getElementById('userPhone').textContent = data.phone || 'Not set';
        document.getElementById('userAddress').textContent = data.address || 'Not set';
        if (data.avatar_url) document.getElementById('userAvatar').src = data.avatar_url;

        // Show admin menu if admin
        if (data.role === 'admin') {
            document.getElementById('adminMenu')?.classList.remove('hidden');
            document.getElementById('adminMenuMobile')?.classList.remove('hidden');
        }
    }

    // ===== Avatar Upload =====
    const avatarInput = document.getElementById('avatarInput');
    const userAvatar = document.getElementById('userAvatar');
    const avatarContainer = document.querySelector('.avatar-container');

    avatarContainer.addEventListener('click', () => avatarInput.click());

    avatarInput.addEventListener('change', async (event) => {
        const file = event.target.files[0];
        if (!file) return;

        try {
            const fileExt = file.name.split('.').pop();
            const fileName = `avatar.${fileExt}`;
            const filePath = `${userId}/${fileName}`;

            // Upload file
            const { error: uploadError } = await client.storage.from('avatars').upload(filePath, file, { upsert: true });
            if (uploadError) throw uploadError;

            // Get public URL
            const { data: publicData, error: urlError } = client.storage.from('avatars').getPublicUrl(filePath);
            if (urlError) throw urlError;
            const publicUrl = publicData.publicUrl;

            // Update profile
            const { error: updateError } = await client.from('profiles')
                .update({ avatar_url: publicUrl })
                .eq('user_id', userId);
            if (updateError) throw updateError;

            userAvatar.src = publicUrl;
            console.log('Avatar updated successfully!');
        } catch (err) {
            console.error('Avatar upload failed:', err);
            alert('Upload failed! Check console for details.');
        }
    });

    // ===== Logout =====
    document.getElementById('logoutBtn').addEventListener('click', async () => {
        await client.auth.signOut();
        window.location.href = 'index.html';
    });

    // ===== Inline Editing =====
    const editBtn = document.getElementById('editBtn');
    let isEditing = false;
    const fields = ['userName', 'userPhone', 'userAddress'];

    editBtn.addEventListener('click', async () => {
        isEditing = !isEditing;

        if (isEditing) {
            editBtn.textContent = 'Save';

            fields.forEach(id => {
                const span = document.getElementById(id);
                const value = span.textContent === 'Not set' ? '' : span.textContent;
                const input = document.createElement('input');
                input.type = 'text';
                input.value = value;
                input.id = id;

                // Style based on field
                input.className = id === 'userAddress'
                    ? 'border rounded-md px-3 py-2 w-full text-gray-700'
                    : 'border rounded-md px-2 py-1 w-64 text-gray-700';

                span.replaceWith(input);
            });

        } else {
            editBtn.textContent = 'Edit';
            const updatedData = {};

            fields.forEach(id => {
                const input = document.getElementById(id);
                updatedData[id] = input.value;

                const span = document.createElement('span');
                span.id = id;
                span.textContent = input.value || 'Not set';
                span.className = id === 'userAddress'
                    ? 'break-words w-full max-w-full'
                    : 'truncate max-w-[250px]';

                input.replaceWith(span);
            });

            try {
                await client.from('profiles').update({
                    full_name: updatedData.userName,
                    phone: updatedData.userPhone,
                    address: updatedData.userAddress
                }).eq('user_id', userId);
                console.log('Profile updated successfully!');
            } catch (err) {
                console.error('Failed to update profile:', err);
                alert('Failed to save changes. Check console.');
            }
        }
    });
})();
