    const SUPABASE_URL = 'https://clhzzjugjttqidiuolrj.supabase.co';
    const SUPABASE_ANON_KEY = 'sb_publishable_X8iVVZsZGbS9h_EKCds1wg_02UyKnpS';
    const client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    (async () => {
        const { data: { session } } = await client.auth.getSession();
        if (!session) return window.location.href = 'signin.html';

        const userId = session.user.id;

        // Show user info
        document.getElementById('userEmail').textContent = session.user.email;

        // Load extra info from 'profiles' table
        const { data, error } = await client.from('profiles')
        .select('*')
        .eq('user_id', userId)
        .single();

        // ===== SHOW ADMIN MENU IF ADMIN =====
        if (data?.role === 'admin') {
        document.getElementById('adminMenu')?.classList.remove('hidden');
        document.getElementById('adminMenuMobile')?.classList.remove('hidden');
        }


        if (error) {
        console.error('Error loading profile:', error);
        } else if (data) {
        document.getElementById('userName').textContent = data.full_name || 'Not set';
        document.getElementById('userPhone').textContent = data.phone || 'Not set';
        document.getElementById('userAddress').textContent = data.address || 'Not set';
        if (data.avatar_url) document.getElementById('userAvatar').src = data.avatar_url;
        }

        // Avatar upload
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
            const filePath = `${userId}/${fileName}`; // Must match storage policy

            // Upload file to bucket
            const { error: uploadError } = await client.storage.from('avatars').upload(filePath, file, { upsert: true });
            if (uploadError) throw uploadError;

            // Get public URL
            const { data: publicData, error: urlError } = client.storage.from('avatars').getPublicUrl(filePath);
            if (urlError) throw urlError;
            const publicUrl = publicData.publicUrl;

            // Update profile table (RLS-safe)
            const { error: updateError } = await client.from('profiles')
            .update({ avatar_url: publicUrl })
            .eq('user_id', userId);
            if (updateError) throw updateError;

            // Update avatar on page
            userAvatar.src = publicUrl;
            console.log('Avatar updated successfully!');
        } catch (err) {
            console.error('Avatar upload failed:', err);
            alert('Upload failed! Check console for details.');
        }
        });

        // Log out
        document.getElementById('logoutBtn').addEventListener('click', async () => {
        await client.auth.signOut();
        window.location.href = 'index.html';
        });

        // ================= Inline Editing =================
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

            // Make shipping address bigger
            if (id === 'userAddress') {
                input.type = 'text';
                input.value = value;
                input.id = id;
                input.className = 'border rounded-md px-3 py-2 w-full text-gray-700';
            } else {
                input.type = 'text';
                input.value = value;
                input.id = id;
                input.className = 'border rounded-md px-2 py-1 w-64 text-gray-700';
            }

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
            span.className = (id === 'userAddress') ? 'break-words w-full max-w-full' : 'truncate max-w-[250px]';

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

    // ================= NAVBAR JS =================
    const navbar = document.getElementById("navbar");
        const menuBtn = document.getElementById("menuBtn");
        const mobileMenu = document.getElementById("mobileMenu");
        const sections = document.querySelectorAll("section");
        const navLinks = document.querySelectorAll(".nav-link");
        const dropdownButton = document.querySelector(".group");
        const dropdownMenu = dropdownButton.querySelector("div");
        const tabButtons = document.querySelectorAll(".tab-btn");
        const tabContents = document.querySelectorAll(".tab-content");

        // Navbar shadow on scroll
        window.addEventListener("scroll", () => {
        if (window.scrollY > 10) {
            navbar.classList.add("shadow-md");
        } else {
            navbar.classList.remove("shadow-md");
        }
        });

        // Toggle the mobile menu with smooth sliding animation
        menuBtn.addEventListener("click", () => {
            // Toggle the hidden class and animation to slide the mobile menu in/out
            mobileMenu.classList.toggle("hidden");
            mobileMenu.classList.toggle("-translate-y-full"); // Slide down on toggle
        });

        // Dropdown hover effects
        dropdownButton.addEventListener("mouseenter", () => {
        dropdownMenu.classList.add("opacity-100", "visibility-visible", "pointer-events-auto");
        dropdownMenu.classList.remove("opacity-0", "visibility-hidden", "pointer-events-none");
        });

        dropdownButton.addEventListener("mouseleave", () => {
        setTimeout(() => {
            if (!dropdownMenu.matches(':hover')) {
            dropdownMenu.classList.add("opacity-0", "visibility-hidden", "pointer-events-none");
            dropdownMenu.classList.remove("opacity-100", "visibility-visible", "pointer-events-auto");
            }
        }, 100);
        });

        dropdownMenu.addEventListener("mouseenter", () => {
        dropdownMenu.classList.add("opacity-100", "visibility-visible", "pointer-events-auto");
        dropdownMenu.classList.remove("opacity-0", "visibility-hidden", "pointer-events-none");
        });

        dropdownMenu.addEventListener("mouseleave", () => {
        dropdownMenu.classList.add("opacity-0", "visibility-hidden", "pointer-events-none");
        dropdownMenu.classList.remove("opacity-100", "visibility-visible", "pointer-events-auto");
        });

        // Active link highlight
        window.addEventListener("scroll", () => {
        let current = "";
        sections.forEach(section => {
            const sectionTop = section.offsetTop - 120;
            if (scrollY >= sectionTop) current = section.getAttribute("id");
        });
        navLinks.forEach(link => {
            link.classList.remove("text-orange-600", "font-semibold");
            if (link.getAttribute("href") === `#${current}`) {
            link.classList.add("text-orange-600", "font-semibold");
            }
        });
        });

        tabButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            // Remove active state
            tabButtons.forEach(b => b.classList.remove("active-tab"));
            tabContents.forEach(c => c.classList.add("hidden"));

            // Activate selected tab
            btn.classList.add("active-tab");
            document.getElementById(btn.dataset.tab).classList.remove("hidden");
        });
    });