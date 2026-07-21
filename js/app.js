import { getProjects, addProject, deleteProject, updateProject, getCategories, addCategory, deleteCategory } from "./projects.js";
import { supabase } from "./supabase.js";

// Espera a que el DOM esté completamente cargado
document.addEventListener("DOMContentLoaded", () => {
    // 1. Inicialización de Elementos del DOM
    const body = document.body;
    const themeToggleBtn = document.getElementById("theme-toggle");
    const menuToggleBtn = document.getElementById("menu-toggle");
    const navMenu = document.getElementById("nav-menu");
    const mobileDrawer = document.getElementById("mobile-drawer");
    const drawerCloseBtn = document.getElementById("drawer-close");
    const drawerOverlay = document.getElementById("drawer-overlay");
    const header = document.querySelector(".header");

    // Modal Admin
    const adminPanelBtn = document.getElementById("admin-panel-btn");
    const adminPanelBtnMobile = document.getElementById("admin-panel-btn-mobile");
    const adminModal = document.getElementById("admin-modal");
    const closeAdminModalBtn = document.getElementById("close-admin-modal");
    const adminModalOverlay = document.getElementById("admin-modal-overlay");
    
    // Login Admin
    const adminPasswordScreen = document.getElementById("admin-password-screen");
    const adminDashboardContent = document.getElementById("admin-dashboard-content");
    const adminEmailInput = document.getElementById("admin-email-input");
    const adminPasswordInput = document.getElementById("admin-password-input");
    const btnSubmitPassword = document.getElementById("btn-submit-password");
    const passwordError = document.getElementById("password-error");

    // Formulario de agregar proyecto
    const adminAddProjectForm = document.getElementById("admin-add-project-form");
    const projTitleInput = document.getElementById("proj-title");
    const projCategorySelect = document.getElementById("proj-category");
    const projDemoInput = document.getElementById("proj-demo");
    const projTagsInput = document.getElementById("proj-tags");
    const projDescInput = document.getElementById("proj-desc");
    const projImageInput = document.getElementById("proj-image");
    const uploadDropzone = document.getElementById("upload-dropzone");
    const imagePreview = document.getElementById("image-preview");
    const adminProjectsList = document.getElementById("admin-projects-list");
    
    // Controles de Edición en Formulario
    const adminFormTitle = document.getElementById("admin-form-title");
    const adminSubmitBtn = document.getElementById("admin-submit-btn");
    const adminCancelEditBtn = document.getElementById("admin-cancel-edit-btn");

    // Gestión de Categorías
    const newCategoryInput = document.getElementById("new-category-input");
    const btnAddCategory = document.getElementById("btn-add-category");
    const adminCategoriesList = document.getElementById("admin-categories-list");
    const filterWrapper = document.getElementById("filter-wrapper");

    // Grilla de Portfolio
    const portfolioGrid = document.getElementById("portfolio-grid");

    // Cotizador
    const comboCards = document.querySelectorAll(".combo-card");
    const addonCheckboxes = document.querySelectorAll("#addons-list input[type='checkbox']");
    const sumComboName = document.getElementById("sum-combo-name");
    const sumComboPrice = document.getElementById("sum-combo-price");
    const sumAddonsList = document.getElementById("sum-addons-list");
    const sumDeliveryTime = document.getElementById("sum-delivery-time");
    const sumTotalPrice = document.getElementById("sum-total-price");
    const btnQuoteWhatsapp = document.getElementById("btn-quote-whatsapp");
    const btnQuotePdf = document.getElementById("btn-quote-pdf");
    const sumTotalPriceArs = document.getElementById("sum-total-price-ars");
    const installmentsDetail = document.getElementById("installments-detail");
    const installmentPriceValue = document.getElementById("installment-price-value");
    const payCashRadio = document.getElementById("pay-cash");
    const payInstallmentsRadio = document.getElementById("pay-installments");
    const dollarRateDisplay = document.getElementById("dollar-rate-display");

    // Formulario de contacto
    const contactForm = document.getElementById("contact-form");
    const contactName = document.getElementById("contact-name");

    let scrollRevealObserver;
    let bindCursorHoverEvents;
    let bindCardGlowTracker;

    // Variables de Estado
    let uploadedImageBase64 = "";
    let isEditMode = false;
    let editingProjectId = null;
    let cachedCategories = [];
    let dollarRate = 1250; // Fallback

    // ==========================================================================
    // 2. Control de Tema (Oscuro / Claro)
    // ==========================================================================
    const currentTheme = localStorage.getItem("theme") || "dark";
    if (currentTheme === "light") {
        body.classList.remove("dark-theme");
        body.classList.add("light-theme");
    } else {
        body.classList.remove("light-theme");
        body.classList.add("dark-theme");
    }

    themeToggleBtn.addEventListener("click", () => {
        if (body.classList.contains("dark-theme")) {
            body.classList.remove("dark-theme");
            body.classList.add("light-theme");
            localStorage.setItem("theme", "light");
        } else {
            body.classList.remove("light-theme");
            body.classList.add("dark-theme");
            localStorage.setItem("theme", "dark");
        }
    });

    // ==========================================================================
    // 3. Menú Móvil (Drawer & Overlay)
    // ==========================================================================
    const toggleMenu = () => {
        mobileDrawer.classList.toggle("open");
        drawerOverlay.classList.toggle("open");
    };

    menuToggleBtn.addEventListener("click", toggleMenu);
    drawerCloseBtn.addEventListener("click", toggleMenu);
    drawerOverlay.addEventListener("click", toggleMenu);

    // Cerrar menú al hacer clic en un enlace del drawer
    document.querySelectorAll(".drawer-link").forEach(link => {
        link.addEventListener("click", () => {
            mobileDrawer.classList.remove("open");
            drawerOverlay.classList.remove("open");
        });
    });

    // Efecto scroll en Header
    window.addEventListener("scroll", () => {
        if (window.scrollY > 50) {
            header.classList.add("scrolled");
        } else {
            header.classList.remove("scrolled");
        }
    });

    // Navegación Activa al hacer Scroll (Intersection Observer)
    const sections = document.querySelectorAll("section");
    const navLinks = document.querySelectorAll(".nav-link");

    const observerOptions = {
        root: null,
        rootMargin: "-20% 0px -60% 0px",
        threshold: 0
    };

    const sectionObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const activeId = entry.target.getAttribute("id");
                navLinks.forEach(link => {
                    link.classList.remove("active");
                    if (link.getAttribute("href") === `#${activeId}`) {
                        link.classList.add("active");
                    }
                });
            }
        });
    }, observerOptions);

    sections.forEach(section => sectionObserver.observe(section));

    // ==========================================================================
    // 4. Renderizado e Interacción del Portfolio (Filtros)
    // ==========================================================================
    // Modo de Diseño: 3D Stage (Apilamiento sticky)
    // ==========================================================================
    const currentDesignMode = "stage";

    async function renderPortfolio(filter = "all") {
        const container = document.getElementById("projects-stack-container");
        if (!container) return;

        container.style.opacity = "0";
        container.style.transition = "opacity 0.2s ease";

        setTimeout(async () => {
            container.innerHTML = "";
            container.className = `w-full relative mb-20`;
            
            const projects = await getProjects();

            const filteredProjects = filter === "all" 
                ? projects 
                : projects.filter(p => p.category === filter);

            if (filteredProjects.length === 0) {
                container.innerHTML = `
                    <div class="glass text-center w-full" style="padding: 40px; border-radius: 28px;">
                        <p style="color: var(--text-secondary);">No hay proyectos cargados en esta categoría.</p>
                    </div>
                `;
                container.style.opacity = "1";
                return;
            }

            filteredProjects.forEach((proj, i) => {
                const card = document.createElement("div");
                const safeImgSrc = (proj.image || "").replace(/"/g, "'");
                const tagsHTML = (proj.tags || []).map(t => `<span class="tag">${t.trim()}</span>`).join("");
                const demoLinkHTML = proj.demoUrl && proj.demoUrl !== '#' ? `
                    <a href="${proj.demoUrl}" target="_blank" rel="noopener" class="stack-card-link">
                        Visitar demo
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
                    </a>
                ` : '';

                // 3D Stage — Stacking Deck
                card.className = "stage-card reveal-on-scroll";
                card.style.zIndex = i + 1;
                card.style.top = `calc(160px + ${i * 35}px)`;
                card.innerHTML = `
                    <div class="stage-card-inner" data-number="0${i + 1}">
                        <div class="stack-card-info">
                            <span class="stack-card-tag">${getCategoryLabel(proj.category)}</span>
                            <h3 class="stack-card-title">${proj.title}</h3>
                            <p class="stack-card-desc">${proj.description}</p>
                            <div style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 24px;">${tagsHTML}</div>
                            ${demoLinkHTML}
                        </div>
                        <div class="stage-img-box">
                            <img src="${safeImgSrc}" alt="${proj.title}" class="stage-img" onerror="this.style.display='none'">
                        </div>
                    </div>
                `;

                container.appendChild(card);

                if (scrollRevealObserver) {
                    scrollRevealObserver.observe(card);
                }
            });

            container.style.opacity = "1";

            if (typeof bindCursorHoverEvents === "function") {
                bindCursorHoverEvents();
            }
            if (typeof bindCardGlowTracker === "function") {
                bindCardGlowTracker();
            }
            if (typeof init3DTilt === "function") {
                init3DTilt();
            }
        }, 200);
    }

    function getCategoryLabel(catId) {
        const cat = cachedCategories.find(c => c.id === catId);
        return cat ? cat.label : "Web";
    }

    // Renderizar Filtros del Portfolio dinámicamente
    async function renderFilters() {
        const activeBtn = filterWrapper.querySelector(".filter-btn.active");
        const activeFilter = activeBtn ? activeBtn.dataset.filter : "all";

        filterWrapper.innerHTML = `<button class="filter-btn" data-filter="all">Todos</button>`;
        const categories = await getCategories();
        cachedCategories = categories; // Actualizar caché
        categories.forEach(cat => {
            filterWrapper.innerHTML += `<button class="filter-btn" data-filter="${cat.id}">${cat.label}</button>`;
        });

        const buttons = filterWrapper.querySelectorAll(".filter-btn");
        let activeRestored = false;
        buttons.forEach(btn => {
            if (btn.dataset.filter === activeFilter) {
                btn.classList.add("active");
                activeRestored = true;
            }
        });
        if (!activeRestored && buttons.length > 0) {
            buttons[0].classList.add("active");
        }

        buttons.forEach(btn => {
            btn.addEventListener("click", () => {
                buttons.forEach(b => b.classList.remove("active"));
                btn.classList.add("active");
                renderPortfolio(btn.dataset.filter);
            });
        });
    }

    // Renderizar las Opciones del Selector de Categorías en el Formulario
    async function renderCategoryDropdown() {
        const currentSelected = projCategorySelect.value;
        projCategorySelect.innerHTML = "";
        const categories = await getCategories();
        cachedCategories = categories; // Actualizar caché
        categories.forEach(cat => {
            const opt = document.createElement("option");
            opt.value = cat.id;
            opt.textContent = cat.label;
            projCategorySelect.appendChild(opt);
        });
        if (currentSelected) {
            projCategorySelect.value = currentSelected;
        }
    }

    // ==========================================================================
    // 5. Panel de Administración (Supabase Auth / LocalStorage Fallback)
    // ==========================================================================
    const openAdminModal = async () => {
        adminModal.classList.add("open");
        adminModalOverlay.classList.add("open");
        mobileDrawer.classList.remove("open");
        drawerOverlay.classList.remove("open");

        // Comprobación si ya se logueó esta sesión (Supabase Session o Fallback)
        try {
            const { data } = await supabase.auth.getSession();
            if (data?.session || sessionStorage.getItem("admin_logged_in") === "true") {
                showAdminDashboard();
            } else {
                showPasswordScreen();
            }
        } catch (e) {
            if (sessionStorage.getItem("admin_logged_in") === "true") {
                showAdminDashboard();
            } else {
                showPasswordScreen();
            }
        }
    };

    const closeAdminModal = () => {
        adminModal.classList.remove("open");
        adminModalOverlay.classList.remove("open");
        exitEditMode();
    };

    adminPanelBtn.addEventListener("click", openAdminModal);
    adminPanelBtnMobile.addEventListener("click", openAdminModal);
    closeAdminModalBtn.addEventListener("click", closeAdminModal);
    adminModalOverlay.addEventListener("click", closeAdminModal);

    function showPasswordScreen() {
        adminPasswordScreen.classList.remove("hidden");
        adminDashboardContent.classList.add("hidden");
        adminEmailInput.value = "";
        adminPasswordInput.value = "";
        passwordError.textContent = "";
    }

    async function showAdminDashboard() {
        adminPasswordScreen.classList.add("hidden");
        adminDashboardContent.classList.remove("hidden");
        await renderAdminProjectsList();
        await renderAdminCategoriesList();
    }

    // Enviar credenciales a Supabase Auth o Fallback local
    btnSubmitPassword.addEventListener("click", async () => {
        const email = adminEmailInput.value.trim();
        const password = adminPasswordInput.value;

        if (!email || !password) {
            passwordError.textContent = "Por favor completa todos los campos.";
            return;
        }

        try {
            // Intentar autenticación con Supabase Auth
            const { data, error } = await supabase.auth.signInWithPassword({
                email,
                password
            });

            if (error) {
                // Si la URL de Supabase es la por defecto (offline) y la clave es admin123, permitimos modo local
                const isConfigured = import.meta.env.VITE_SUPABASE_URL && !import.meta.env.VITE_SUPABASE_URL.includes("tu-proyecto-id");
                if (!isConfigured && password === "admin123") {
                    sessionStorage.setItem("admin_logged_in", "true");
                    await showAdminDashboard();
                    return;
                }
                throw error;
            }

            // Login exitoso
            await showAdminDashboard();
        } catch (err) {
            console.error("Error de Login:", err);
            passwordError.textContent = err.message || "Credenciales incorrectas.";
        }
    });

    adminPasswordInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
            btnSubmitPassword.click();
        }
    });

    // Control de Imagen en Admin (Base64)
    uploadDropzone.addEventListener("click", () => projImageInput.click());

    projImageInput.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (file) {
            processFile(file);
        }
    });

    // Drag & Drop
    uploadDropzone.addEventListener("dragover", (e) => {
        e.preventDefault();
        uploadDropzone.style.borderColor = "var(--primary)";
    });

    uploadDropzone.addEventListener("dragleave", () => {
        uploadDropzone.style.borderColor = "var(--border)";
    });

    uploadDropzone.addEventListener("drop", (e) => {
        e.preventDefault();
        uploadDropzone.style.borderColor = "var(--border)";
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith("image/")) {
            processFile(file);
        }
    });

    function processFile(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            uploadedImageBase64 = e.target.result;
            imagePreview.src = uploadedImageBase64;
            imagePreview.classList.remove("hidden");
            uploadDropzone.classList.add("hidden");
        };
        reader.readAsDataURL(file);
    }

    // Enviar Formulario de Carga / Edición
    adminAddProjectForm.addEventListener("submit", async (e) => {
        e.preventDefault();

        // Validaciones
        const title = projTitleInput.value.trim();
        const category = projCategorySelect.value;
        const demoUrl = projDemoInput.value.trim() || "#";
        const tags = projTagsInput.value.split(",").map(t => t.trim()).filter(t => t !== "");
        const description = projDescInput.value.trim();

        if (!title || !description) {
            Swal.fire("Atención", "Por favor completa los campos requeridos.", "warning");
            return;
        }

        let projectImage = uploadedImageBase64;
        if (!projectImage) {
            // Si estamos editando y no se subió una nueva imagen, conservamos la actual
            if (isEditMode) {
                const projects = await getProjects();
                const existingProj = projects.find(p => p.id === editingProjectId);
                projectImage = existingProj ? existingProj.image : "";
            }
            // Si no hay imagen, generamos un SVG de gradiente dinámico
            if (!projectImage) {
                const hue = Math.floor(Math.random() * 360);
                projectImage = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500"><defs><linearGradient id="rand" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="hsl(${hue}, 80%, 45%)"/><stop offset="100%" stop-color="hsl(${(hue + 60) % 360}, 85%, 25%)"/></linearGradient></defs><rect width="800" height="500" fill="url(%23rand)"/><text x="400" y="260" fill="white" font-family="sans-serif" font-size="36" font-weight="bold" text-anchor="middle">${title.toUpperCase()}</text></svg>`;
            }
        }

        const projectData = {
            title,
            description,
            category,
            image: projectImage,
            tags,
            demoUrl
        };

        if (isEditMode) {
            projectData.id = editingProjectId;
            await updateProject(projectData);
            exitEditMode();
            Swal.fire("¡Actualizado!", "¡Proyecto actualizado con éxito!", "success");
        } else {
            await addProject(projectData);
            resetAdminForm();
            Swal.fire("¡Creado!", "¡Proyecto agregado con éxito!", "success");
        }

        await renderAdminProjectsList();
        
        // Obtener filtro activo en portfolio y refrescar
        const activeFilterBtn = document.querySelector(".filter-btn.active");
        await renderPortfolio(activeFilterBtn ? activeFilterBtn.dataset.filter : "all");
    });

    function resetAdminForm() {
        adminAddProjectForm.reset();
        uploadedImageBase64 = "";
        imagePreview.src = "";
        imagePreview.classList.add("hidden");
        uploadDropzone.classList.remove("hidden");
    }

    function exitEditMode() {
        isEditMode = false;
        editingProjectId = null;
        resetAdminForm();
        adminFormTitle.textContent = "Cargar Nuevo Proyecto";
        adminSubmitBtn.textContent = "Agregar Proyecto";
        adminCancelEditBtn.classList.add("hidden");
    }

    adminCancelEditBtn.addEventListener("click", exitEditMode);

    // Renderizar la lista de edición/borrado en Admin (Asíncrono)
    async function renderAdminProjectsList() {
        adminProjectsList.innerHTML = "";
        const projects = await getProjects();

        projects.forEach(proj => {
            const item = document.createElement("div");
            item.className = "admin-project-item";
            item.innerHTML = `
                <div class="admin-project-meta">
                    <div class="admin-project-name">${proj.title}</div>
                    <div class="admin-project-cat">${getCategoryLabel(proj.category)}</div>
                </div>
                <div class="admin-project-actions">
                    <button class="btn-edit-proj" data-id="${proj.id}" title="Editar proyecto">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                    </button>
                    <button class="btn-delete-proj" data-id="${proj.id}" title="Eliminar proyecto">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                    </button>
                </div>
            `;
            adminProjectsList.appendChild(item);
        });

        // Event Listeners para botones de editar
        document.querySelectorAll(".btn-edit-proj").forEach(btn => {
            btn.addEventListener("click", async () => {
                const id = btn.dataset.id;
                const projectsList = await getProjects();
                const proj = projectsList.find(p => p.id === id);
                if (proj) {
                    isEditMode = true;
                    editingProjectId = id;

                    // Llenar formulario
                    projTitleInput.value = proj.title;
                    projCategorySelect.value = proj.category;
                    projDemoInput.value = proj.demoUrl === "#" ? "" : proj.demoUrl;
                    projTagsInput.value = proj.tags.join(", ");
                    projDescInput.value = proj.description;

                    // Vista previa de imagen
                    uploadedImageBase64 = proj.image;
                    imagePreview.src = proj.image;
                    imagePreview.classList.remove("hidden");
                    uploadDropzone.classList.add("hidden");

                    // Cambiar UI del formulario
                    adminFormTitle.textContent = "Editar Proyecto";
                    adminSubmitBtn.textContent = "Guardar Cambios";
                    adminCancelEditBtn.classList.remove("hidden");

                    // Scroll hacia arriba del formulario
                    document.querySelector(".admin-form-container").scrollIntoView({ behavior: "smooth" });
                }
            });
        });

        // Event Listeners para botones de eliminar
        document.querySelectorAll(".btn-delete-proj").forEach(btn => {
            btn.addEventListener("click", async (e) => {
                const id = btn.dataset.id;
                const projName = btn.parentElement.parentElement.querySelector(".admin-project-name").textContent;
                
                Swal.fire({
                    title: '¿Estás seguro?',
                    text: `¿Estás seguro de eliminar el proyecto "${projName}"?`,
                    icon: 'warning',
                    showCancelButton: true,
                    confirmButtonColor: '#6366f1',
                    cancelButtonColor: '#ef4444',
                    confirmButtonText: 'Sí, eliminar',
                    cancelButtonText: 'Cancelar'
                }).then(async (result) => {
                    if (result.isConfirmed) {
                        await deleteProject(id);
                        if (isEditMode && editingProjectId === id) {
                            exitEditMode();
                        }
                        await renderAdminProjectsList();
                        // Refrescar portfolio general
                        const activeFilterBtn = document.querySelector(".filter-btn.active");
                        await renderPortfolio(activeFilterBtn ? activeFilterBtn.dataset.filter : "all");
                        Swal.fire('¡Eliminado!', 'El proyecto ha sido eliminado con éxito.', 'success');
                    }
                });
            });
        });
    }

    // ==========================================================================
    // 6. Cotizador Interactivo de Presupuestos
    // ==========================================================================
    // ==========================================================================
    // 6. Cotizador Interactivo de Presupuestos
    // ==========================================================================
    async function fetchDollarRate() {
        try {
            const res = await fetch("https://dolarapi.com/v1/dolares/blue");
            if (res.ok) {
                const data = await res.json();
                if (data && data.venta) {
                    dollarRate = parseFloat(data.venta);
                    console.log("Cotización Dólar Blue cargada con éxito:", dollarRate);
                }
            }
        } catch (error) {
            console.error("Error cargando Dólar API, usando la cotización predeterminada:", error);
        } finally {
            if (dollarRateDisplay) {
                dollarRateDisplay.textContent = `Cotización Dólar Blue: $${dollarRate} ARS`;
            }
            calculateQuotation();
        }
    }

    function calculateQuotation() {
        let baseTotal = 0;
        let totalTime = 0;
        
        // 1. Obtener combo seleccionado
        const activeComboCard = document.querySelector(".combo-card.active");
        if (!activeComboCard) return;

        const comboName = activeComboCard.querySelector("h4").textContent;
        const comboBasePrice = parseInt(activeComboCard.dataset.price);
        const comboBaseTime = parseInt(activeComboCard.dataset.time);

        baseTotal += comboBasePrice;
        totalTime += comboBaseTime;

        // Actualizar resumen de combo
        sumComboName.textContent = comboName;
        sumComboPrice.textContent = `$${comboBasePrice} USD`;

        // 2. Obtener adicionales seleccionados
        sumAddonsList.innerHTML = "";
        let hasAddons = false;

        addonCheckboxes.forEach(checkbox => {
            if (checkbox.checked) {
                hasAddons = true;
                const addonName = checkbox.parentElement.querySelector(".addon-title").textContent;
                const addonPrice = parseInt(checkbox.dataset.price);
                const addonTime = parseInt(checkbox.dataset.time);

                baseTotal += addonPrice;
                totalTime += addonTime;

                // Agregar elemento a la lista visual del resumen
                const li = document.createElement("li");
                li.innerHTML = `
                    <span class="add-item-name" title="${addonName}">${addonName}</span>
                    <span>+$${addonPrice} USD</span>
                `;
                sumAddonsList.appendChild(li);
            }
        });

        if (!hasAddons) {
            sumAddonsList.innerHTML = `<li class="no-addons">Ningún adicional seleccionado</li>`;
        }

        // 3. Evaluar método de pago (3 cuotas con +10% recargo)
        const isInstallments = payInstallmentsRadio && payInstallmentsRadio.checked;
        let finalTotalUsd = baseTotal;
        
        if (isInstallments) {
            finalTotalUsd = Math.round(baseTotal * 1.10);
            const installmentUsd = (finalTotalUsd / 3).toFixed(2);
            const installmentArs = Math.round((finalTotalUsd * dollarRate) / 3);
            
            if (installmentsDetail && installmentPriceValue) {
                installmentsDetail.classList.remove("hidden");
                installmentPriceValue.textContent = `$${installmentUsd} USD ($${installmentArs.toLocaleString("es-AR")} ARS) c/u`;
            }
        } else {
            if (installmentsDetail) {
                installmentsDetail.classList.add("hidden");
            }
        }

        const finalTotalArs = Math.round(finalTotalUsd * dollarRate);

        // 4. Escribir resultados finales en la tarjeta resumen
        sumDeliveryTime.textContent = `${totalTime} días hábiles`;
        sumTotalPrice.textContent = `$${finalTotalUsd} USD`;
        if (sumTotalPriceArs) {
            sumTotalPriceArs.textContent = `$${finalTotalArs.toLocaleString("es-AR")} ARS`;
        }
    }

    // Eventos para interactuar con los combos
    comboCards.forEach(card => {
        card.addEventListener("click", () => {
            comboCards.forEach(c => c.classList.remove("active"));
            card.classList.add("active");
            calculateQuotation();
        });
    });

    // Eventos para interactuar con los checkboxes adicionales
    addonCheckboxes.forEach(checkbox => {
        checkbox.addEventListener("change", calculateQuotation);
    });

    // Eventos para métodos de pago
    if (payCashRadio) payCashRadio.addEventListener("change", calculateQuotation);
    if (payInstallmentsRadio) payInstallmentsRadio.addEventListener("change", calculateQuotation);

    // ==========================================================================
    // 7. Envíos de Cotización (WhatsApp & Mail)
    // ==========================================================================
    function generateQuotationText() {
        const clientName = contactName.value.trim() || "Cliente Interesado";
        
        const activeComboCard = document.querySelector(".combo-card.active");
        const comboName = activeComboCard.querySelector("h4").textContent;
        const comboBasePrice = activeComboCard.dataset.price;

        let addonsText = "";
        addonCheckboxes.forEach(cb => {
            if (cb.checked) {
                const addonName = cb.parentElement.querySelector(".addon-title").textContent;
                const addonPrice = cb.dataset.price;
                addonsText += `   • ${addonName} (+$${addonPrice} USD)\n`;
            }
        });

        if (!addonsText) {
            addonsText = "   • Ninguno\n";
        }

        const isInstallments = payInstallmentsRadio && payInstallmentsRadio.checked;
        const totalUsd = sumTotalPrice.textContent;
        const totalArs = sumTotalPriceArs ? sumTotalPriceArs.textContent : "";
        const time = sumDeliveryTime.textContent;
        
        let paymentText = `💵 *Forma de pago:* Contado / Transferencia (1 pago)\n`;
        if (isInstallments) {
            const finalTotalUsd = parseInt(totalUsd.replace(/\D/g, ""));
            const installmentUsd = (finalTotalUsd / 3).toFixed(2);
            const installmentArs = Math.round((finalTotalUsd * dollarRate) / 3);
            
            paymentText = `💳 *Forma de pago:* 3 Cuotas sin interés (+10% recargo)\n` +
                          `👉 *Cuotas:* 3 cuotas de $${installmentUsd} USD ($${installmentArs.toLocaleString("es-AR")} ARS) cada una\n`;
        }

        const text = `Hola Ariel! Me contacto desde tu portfolio web. Mi nombre es *${clientName}*.\n\n` +
            `Me gustaría solicitar un presupuesto estimado basado en tu cotizador online:\n\n` +
            `🔹 *Combo seleccionado:* ${comboName} ($${comboBasePrice} USD)\n` +
            `➕ *Adicionales elegidos:*\n${addonsText}\n` +
            `${paymentText}` +
            `🕒 *Tiempo de entrega estimado:* ${time}\n` +
            `💰 *PRESUPUESTO TOTAL ESTIMADO:* ${totalUsd} / ${totalArs}\n` +
            `📈 *Tipo de cambio de referencia (Dólar Blue):* $${dollarRate} ARS\n\n` +
            `Quedo atento/a para que podamos coordinar los detalles. ¡Gracias!`;

        return text;
    }

    // Botón de WhatsApp
    btnQuoteWhatsapp.addEventListener("click", () => {
        const message = generateQuotationText();
        const encodedMessage = encodeURIComponent(message);
        const phoneNumber = "543517877753"; 
        const whatsappUrl = `https://wa.me/${phoneNumber}?text=${encodedMessage}`;
        window.open(whatsappUrl, "_blank");
    });



    // Botón de PDF
    if (btnQuotePdf) {
        btnQuotePdf.addEventListener("click", async () => {
            // --- Pedir nombre del destinatario con SweetAlert ---
            const { value: recipientName, isConfirmed } = await Swal.fire({
                title: "Nombre del destinatario",
                input: "text",
                inputLabel: "Ingresá el nombre o empresa para el presupuesto",
                inputPlaceholder: "Ej: Juan Pérez / Empresa SRL",
                inputValue: contactName.value.trim() || "",
                showCancelButton: true,
                confirmButtonText: "Generar PDF",
                cancelButtonText: "Cancelar",
                confirmButtonColor: "#6366f1",
                inputValidator: (value) => {
                    if (!value || !value.trim()) {
                        return "Por favor ingresá un nombre para el destinatario.";
                    }
                }
            });

            if (!isConfirmed || !recipientName) return;
            const clientName = recipientName.trim();

            const activeComboCard = document.querySelector(".combo-card.active");
            if (!activeComboCard) return;
            const comboName = activeComboCard.querySelector("h4").textContent;
            const comboDesc = activeComboCard.querySelector(".combo-desc")?.textContent || "";
            const comboPrice = parseInt(activeComboCard.dataset.price);

            // Recopilar features del combo seleccionado
            const comboFeatures = [];
            activeComboCard.querySelectorAll(".combo-details li").forEach(li => {
                comboFeatures.push(li.textContent.trim());
            });

            const addons = [];
            addonCheckboxes.forEach(cb => {
                if (cb.checked) {
                    addons.push({
                        name: cb.parentElement.querySelector(".addon-title").textContent,
                        price: parseInt(cb.dataset.price)
                    });
                }
            });

            const now = new Date();
            const dateStr = now.toLocaleDateString("es-AR", {
                day: "numeric",
                month: "long",
                year: "numeric"
            });
            const quoteNum = `AD-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;

            let addonsMarkup = "";
            let baseTotal = comboPrice;
            addons.forEach((addon, i) => {
                baseTotal += addon.price;
                addonsMarkup += `
                    <tr>
                        <td style="padding-left: 24px; color: #475569;">+ ${addon.name}</td>
                        <td class="price-col">$${addon.price} USD</td>
                        <td class="price-col">$${(addon.price * dollarRate).toLocaleString("es-AR")} ARS</td>
                    </tr>
                `;
            });

            const isInstallments = payInstallmentsRadio && payInstallmentsRadio.checked;
            let finalTotalUsd = baseTotal;
            let chargeMarkup = "";
            let installmentsMarkup = "";

            if (isInstallments) {
                finalTotalUsd = Math.round(baseTotal * 1.10);
                const chargeUsd = finalTotalUsd - baseTotal;
                const chargeArs = chargeUsd * dollarRate;
                chargeMarkup = `
                    <tr>
                        <td>Recargo 10% (Financiación)</td>
                        <td style="text-align: right;">+$${chargeUsd} USD</td>
                    </tr>
                    <tr>
                        <td>Recargo ARS</td>
                        <td style="text-align: right;">+$${chargeArs.toLocaleString("es-AR")} ARS</td>
                    </tr>
                `;

                const installmentUsd = (finalTotalUsd / 3).toFixed(2);
                const installmentArs = Math.round((finalTotalUsd * dollarRate) / 3).toLocaleString("es-AR");
                
                installmentsMarkup = `
                    <div class="installments-box">
                        <div class="installments-icon">💳</div>
                        <div>
                            <strong>Financiación en 3 cuotas</strong>
                            <p style="margin: 4px 0 0 0;">3 cuotas mensuales de <strong>$${installmentUsd} USD</strong> ($${installmentArs} ARS) cada una.</p>
                        </div>
                    </div>
                `;
            }

            const finalTotalArs = Math.round(finalTotalUsd * dollarRate);
            const time = sumDeliveryTime.textContent;

            // Generar features markup
            let featuresMarkup = "";
            if (comboFeatures.length > 0) {
                featuresMarkup = comboFeatures.map(f => `<li>${f}</li>`).join("");
                featuresMarkup = `
                    <div class="features-box">
                        <h3 style="margin: 0 0 8px 0; font-family: 'Outfit', sans-serif; font-size: 0.95rem; color: #0f172a;">Incluye:</h3>
                        <ul class="features-list">${featuresMarkup}</ul>
                    </div>
                `;
            }

            const container = document.createElement("div");
            container.id = "quote-print-container";
            container.style.position = "fixed";
            container.style.left = "0";
            container.style.top = "0";
            container.style.width = "1px";
            container.style.height = "1px";
            container.style.overflow = "hidden";
            container.style.background = "transparent";
            container.style.zIndex = "99999";
            container.style.pointerEvents = "none";

            const tempDiv = document.createElement("div");
            tempDiv.id = "quote-print-temp";
            tempDiv.style.width = "750px";
            tempDiv.style.background = "#ffffff";
            tempDiv.style.boxSizing = "border-box";

            const htmlContent = `
                <style>
                    .pdf-container {
                        font-family: 'Inter', 'Segoe UI', sans-serif;
                        color: #1e293b;
                        background-color: #ffffff;
                        padding: 0;
                        line-height: 1.5;
                        font-size: 13px;
                        box-sizing: border-box;
                    }

                    /* ── Header con barra de color ── */
                    .pdf-header-bar {
                        background: linear-gradient(135deg, #6366f1 0%, #06b6d4 100%);
                        padding: 24px 40px;
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                    }
                    .pdf-header-bar .logo {
                        font-family: 'Outfit', sans-serif;
                        font-weight: 800;
                        font-size: 1.8rem;
                        color: #ffffff;
                        letter-spacing: -0.5px;
                    }
                    .pdf-header-bar .logo span {
                        opacity: 0.85;
                    }
                    .pdf-header-bar .doc-meta {
                        text-align: right;
                        color: rgba(255,255,255,0.9);
                        font-size: 0.85rem;
                    }
                    .pdf-header-bar .doc-meta p { margin: 2px 0; }
                    .pdf-header-bar .quote-ref {
                        font-family: 'Outfit', monospace;
                        font-weight: 700;
                        font-size: 0.9rem;
                        color: #fff;
                        background: rgba(255,255,255,0.2);
                        padding: 3px 10px;
                        border-radius: 4px;
                        display: inline-block;
                        margin-bottom: 4px;
                    }

                    /* ── Body ── */
                    .pdf-body {
                        padding: 28px 40px 20px 40px;
                    }

                    .pdf-title {
                        font-family: 'Outfit', sans-serif;
                        font-size: 1.6rem;
                        font-weight: 700;
                        color: #0f172a;
                        margin: 0 0 18px 0;
                        padding-bottom: 10px;
                        border-bottom: 2px solid #e2e8f0;
                    }

                    /* ── Info cards ── */
                    .info-grid {
                        display: grid;
                        grid-template-columns: 1fr 1fr;
                        gap: 14px;
                        margin-bottom: 22px;
                    }
                    .info-card {
                        background-color: #f8fafc;
                        border: 1px solid #e2e8f0;
                        border-radius: 8px;
                        padding: 14px 16px;
                    }
                    .info-card h4 {
                        margin: 0 0 6px 0;
                        font-family: 'Outfit', sans-serif;
                        font-size: 0.8rem;
                        text-transform: uppercase;
                        letter-spacing: 0.5px;
                        color: #6366f1;
                        font-weight: 600;
                    }
                    .info-card p {
                        margin: 3px 0;
                        font-size: 0.9rem;
                        color: #334155;
                    }

                    /* ── Features box ── */
                    .features-box {
                        background: #f0f9ff;
                        border: 1px solid #bae6fd;
                        border-radius: 8px;
                        padding: 14px 18px;
                        margin-bottom: 22px;
                    }
                    .features-list {
                        margin: 0;
                        padding: 0;
                        list-style: none;
                        display: grid;
                        grid-template-columns: 1fr 1fr;
                        gap: 5px 16px;
                    }
                    .features-list li {
                        font-size: 0.88rem;
                        color: #334155;
                        padding-left: 18px;
                        position: relative;
                    }
                    .features-list li::before {
                        content: "✓";
                        position: absolute;
                        left: 0;
                        color: #0ea5e9;
                        font-weight: 700;
                    }

                    /* ── Table ── */
                    .pdf-table {
                        width: 100%;
                        border-collapse: collapse;
                        margin-bottom: 20px;
                    }
                    .pdf-table th {
                        background-color: #f1f5f9;
                        color: #0f172a;
                        font-family: 'Outfit', sans-serif;
                        font-weight: 600;
                        text-align: left;
                        padding: 10px 14px;
                        font-size: 0.85rem;
                        text-transform: uppercase;
                        letter-spacing: 0.3px;
                        border-bottom: 2px solid #cbd5e1;
                    }
                    .pdf-table td {
                        padding: 10px 14px;
                        font-size: 0.9rem;
                        border-bottom: 1px solid #e2e8f0;
                        color: #334155;
                    }
                    .price-col {
                        text-align: right;
                        font-family: 'Inter', monospace;
                        font-weight: 500;
                    }

                    /* ── Totals ── */
                    .totals-section {
                        display: flex;
                        justify-content: flex-end;
                        margin-bottom: 20px;
                    }
                    .totals-table {
                        width: 340px;
                        margin-bottom: 0;
                        border-collapse: collapse;
                    }
                    .totals-table td {
                        padding: 6px 12px;
                        border-bottom: none;
                        font-size: 0.9rem;
                    }
                    .totals-table tr.grand-total td {
                        font-family: 'Outfit', sans-serif;
                        font-size: 1.15rem;
                        font-weight: 700;
                        color: #6366f1;
                        border-top: 2px solid #e2e8f0;
                        padding-top: 8px;
                    }
                    .totals-table tr.grand-total-ars td {
                        font-family: 'Outfit', sans-serif;
                        font-size: 1.05rem;
                        font-weight: 600;
                        color: #06b6d4;
                    }

                    /* ── Installments ── */
                    .installments-box {
                        background: linear-gradient(135deg, #fdf2f8 0%, #fce7f3 100%);
                        border: 1px solid #fbcfe8;
                        border-radius: 8px;
                        padding: 14px 16px;
                        margin-bottom: 20px;
                        color: #9d174d;
                        font-size: 0.9rem;
                        display: flex;
                        gap: 12px;
                        align-items: flex-start;
                    }
                    .installments-icon {
                        font-size: 1.4rem;
                        line-height: 1;
                    }

                    /* ── Terms ── */
                    .terms-section {
                        background: #fafafa;
                        border: 1px solid #e5e7eb;
                        border-radius: 8px;
                        padding: 12px 16px;
                        margin-bottom: 18px;
                    }
                    .terms-section h4 {
                        margin: 0 0 6px 0;
                        font-family: 'Outfit', sans-serif;
                        font-size: 0.85rem;
                        color: #6b7280;
                        text-transform: uppercase;
                        letter-spacing: 0.5px;
                    }
                    .terms-section ul {
                        margin: 0;
                        padding-left: 18px;
                        font-size: 0.8rem;
                        color: #6b7280;
                        line-height: 1.6;
                    }

                    /* ── Footer ── */
                    .pdf-footer {
                        border-top: 2px solid #e2e8f0;
                        padding-top: 14px;
                        margin-top: 10px;
                        font-size: 0.8rem;
                        color: #64748b;
                        display: flex;
                        justify-content: space-between;
                        align-items: flex-end;
                    }
                    .pdf-footer p { margin: 2px 0; }
                    .pdf-footer span {
                        color: #334155;
                        font-weight: 500;
                    }
                    .pdf-footer .brand {
                        font-family: 'Outfit', sans-serif;
                        font-weight: 700;
                        color: #6366f1;
                        font-size: 0.9rem;
                    }
                </style>
                <div class="pdf-container">
                    <!-- Header con gradiente -->
                    <div class="pdf-header-bar">
                        <div class="logo">Ariel<span>.Dev</span></div>
                        <div class="doc-meta">
                            <div class="quote-ref">${quoteNum}</div>
                            <p>${dateStr}</p>
                        </div>
                    </div>

                    <div class="pdf-body">
                        <h1 class="pdf-title">Propuesta Técnica y Económica</h1>
                        
                        <!-- Info cards -->
                        <div class="info-grid">
                            <div class="info-card">
                                <h4>Destinatario</h4>
                                <p style="font-weight: 600; font-size: 1rem; color: #0f172a;">${clientName}</p>
                            </div>
                            <div class="info-card">
                                <h4>Desarrollador</h4>
                                <p style="font-weight: 600; color: #0f172a;">Ariel Martinelli</p>
                                <p>Córdoba, Argentina</p>
                            </div>
                            <div class="info-card">
                                <h4>Paquete seleccionado</h4>
                                <p style="font-weight: 600; color: #0f172a;">${comboName}</p>
                                ${comboDesc ? `<p style="font-size: 0.82rem; color: #64748b;">${comboDesc}</p>` : ""}
                            </div>
                            <div class="info-card">
                                <h4>Condiciones</h4>
                                <p><strong>Validez:</strong> 15 días</p>
                                <p><strong>Entrega:</strong> ${time}</p>
                            </div>
                        </div>

                        <!-- Features del combo -->
                        ${featuresMarkup}

                        <!-- Tabla de precios -->
                        <table class="pdf-table">
                            <thead>
                                <tr>
                                    <th>Servicio</th>
                                    <th class="price-col">USD</th>
                                    <th class="price-col">ARS</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr>
                                    <td><strong>${comboName}</strong></td>
                                    <td class="price-col">$${comboPrice}</td>
                                    <td class="price-col">$${(comboPrice * dollarRate).toLocaleString("es-AR")}</td>
                                </tr>
                                ${addonsMarkup}
                            </tbody>
                        </table>

                        ${installmentsMarkup}

                        <!-- Totales -->
                        <div class="totals-section">
                            <table class="totals-table">
                                <tr>
                                    <td>Subtotal USD</td>
                                    <td style="text-align: right; font-weight: 500;">$${baseTotal}</td>
                                </tr>
                                <tr>
                                    <td>Subtotal ARS</td>
                                    <td style="text-align: right; font-weight: 500;">$${(baseTotal * dollarRate).toLocaleString("es-AR")}</td>
                                </tr>
                                ${chargeMarkup}
                                <tr class="grand-total">
                                    <td>Total USD</td>
                                    <td style="text-align: right;">$${finalTotalUsd}</td>
                                </tr>
                                <tr class="grand-total-ars">
                                    <td>Total ARS</td>
                                    <td style="text-align: right;">$${finalTotalArs.toLocaleString("es-AR")}</td>
                                </tr>
                            </table>
                        </div>

                        <!-- Términos -->
                        <div class="terms-section">
                            <h4>Términos y condiciones</h4>
                            <ul>
                                <li>Los precios en ARS están sujetos a la cotización del dólar al momento del pago.</li>
                                <li>El presupuesto tiene una validez de 15 días corridos desde la fecha de emisión.</li>
                                <li>El tiempo de entrega comienza a correr desde la confirmación del proyecto y recepción del adelanto.</li>
                                <li>Se requiere un adelanto del 50% para iniciar el desarrollo.</li>
                            </ul>
                        </div>

                        <!-- Footer -->
                        <div class="pdf-footer">
                            <div>
                                <p>Email: <span>ariel.martinelli.dev@gmail.com</span></p>
                                <p>WhatsApp: <span>+54 351 787 7753</span></p>
                                <p>Córdoba, Argentina</p>
                            </div>
                            <div style="text-align: right;">
                                <div class="brand">Ariel.Dev</div>
                                <p>arieldev.com.ar</p>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            tempDiv.innerHTML = htmlContent;
            container.appendChild(tempDiv);
            document.body.appendChild(container);

            const pdfFilename = `Presupuesto_ArielDev_${clientName.replace(/\s+/g, "_")}.pdf`;
            const opt = {
                margin:       0,
                filename:     pdfFilename,
                image:        { type: 'jpeg', quality: 0.98 },
                html2canvas:  { 
                    scale: 2, 
                    useCORS: true, 
                    logging: false,
                    scrollX: 0,
                    scrollY: 0,
                    x: 0,
                    y: 0,
                    windowWidth: 750
                },
                jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
            };

            if (typeof html2pdf !== "undefined") {
                html2pdf().set(opt).from(tempDiv).save().then(() => {
                    document.body.removeChild(container);
                }).catch(err => {
                    console.error("Error al descargar PDF:", err);
                    document.body.removeChild(container);
                });
            } else {
                Swal.fire("Descarga de PDF", "La librería de descarga de PDF está cargando. Por favor, intenta de nuevo en unos segundos.", "info");
                document.body.removeChild(container);
            }
        });
    }

    // Formulario de Contacto General
    contactForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const name = contactName.value.trim();
        const email = document.getElementById("contact-email").value.trim();
        const subject = document.getElementById("contact-subject").value.trim();
        const message = document.getElementById("contact-message").value.trim();

        if (!name || !email || !subject || !message) {
            Swal.fire("Atención", "Por favor, completa todos los campos del formulario.", "warning");
            return;
        }

        // Mensaje de éxito de simulación
        Swal.fire("¡Gracias!", `¡Gracias por tu mensaje, ${name}! Se ha enviado la consulta con éxito. Ariel se pondrá en contacto a la brevedad.`, "success");
        contactForm.reset();
    });

    // Agregar nueva categoría
    btnAddCategory.addEventListener("click", async () => {
        const label = newCategoryInput.value.trim();
        if (!label) {
            Swal.fire("Atención", "Por favor escribe un nombre para la categoría.", "warning");
            return;
        }

        const res = await addCategory(label);
        if (res.error) {
            Swal.fire("Error", res.error, "error");
        } else {
            newCategoryInput.value = "";
            await renderFilters();
            await renderCategoryDropdown();
            await renderAdminCategoriesList();
            Swal.fire("¡Éxito!", `Categoría "${label}" agregada con éxito.`, "success");
        }
    });

    newCategoryInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
            btnAddCategory.click();
        }
    });

    // Renderizar la lista de categorías en Admin
    async function renderAdminCategoriesList() {
        adminCategoriesList.innerHTML = "";
        const categories = await getCategories();
        const defaultIds = ["landing", "ecommerce", "portfolio", "custom"];

        categories.forEach(cat => {
            const item = document.createElement("div");
            item.className = "admin-category-item";
            const isDefault = defaultIds.includes(cat.id);
            
            item.innerHTML = `
                <div class="admin-category-name">${cat.label}</div>
                <button class="btn-delete-cat" data-id="${cat.id}" ${isDefault ? 'disabled' : ''} title="${isDefault ? 'Las categorías por defecto no se pueden borrar' : 'Eliminar categoría'}">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
            `;
            adminCategoriesList.appendChild(item);
        });

        // Event listeners para borrar categorías
        adminCategoriesList.querySelectorAll(".btn-delete-cat").forEach(btn => {
            btn.addEventListener("click", async () => {
                const id = btn.dataset.id;
                const catName = btn.parentElement.querySelector(".admin-category-name").textContent;
                Swal.fire({
                    title: '¿Estás seguro?',
                    text: `¿Estás seguro de eliminar la categoría "${catName}"?`,
                    icon: 'warning',
                    showCancelButton: true,
                    confirmButtonColor: '#6366f1',
                    cancelButtonColor: '#ef4444',
                    confirmButtonText: 'Sí, eliminar',
                    cancelButtonText: 'Cancelar'
                }).then(async (result) => {
                    if (result.isConfirmed) {
                        const res = await deleteCategory(id);
                        if (res.error) {
                            Swal.fire("Error", res.error, "error");
                        } else {
                            await renderFilters();
                            await renderCategoryDropdown();
                            await renderAdminCategoriesList();
                            await renderPortfolio();
                            Swal.fire('¡Eliminado!', 'La categoría ha sido eliminada con éxito.', 'success');
                        }
                    }
                });
            });
        });
    }

    // ==========================================================================
    // 8. Inicialización al cargar la página
    // ==========================================================================
    async function init() {
        // Cargar caché de categorías inicialmente
        cachedCategories = await getCategories();
        await renderFilters();
        await renderCategoryDropdown();
        await renderPortfolio();
        await fetchDollarRate();

        // Redirección de "Beneficios de Tener"
        const btnVerVentajas = document.getElementById("btn-ver-ventajas");
        const selectServicio = document.getElementById("select-servicio");
        if (btnVerVentajas && selectServicio) {
            btnVerVentajas.addEventListener("click", () => {
                const service = selectServicio.value;
                window.location.href = `ventajas-${service}.html`;
            });
        }

        // ---- REDISEÑO PREMIUM ----
        // initSmoothScroll();
        initCustomCursor();
        initScrollEffects();
        initMagnetEffect();
        initCodeTypingEffect();
        init3DTilt();
        initStackingProjectsScroll();
        initCardGlowTracker();
    }

    // ==========================================================================
    // 9. REDISEÑO PREMIUM: Efectos 3D y Escritura en Vivo
    // ==========================================================================

    /**
     * Efecto magnético en el cuadro de código del Hero (magnet-target)
     */
    function initMagnetEffect() {
        const magnets = document.querySelectorAll('.magnet-target');
        magnets.forEach(magnet => {
            magnet.addEventListener('mousemove', (e) => {
                if (window.innerWidth < 1024) {
                    magnet.style.transform = 'translate(0, 0)';
                    return;
                }
                const rect = magnet.getBoundingClientRect();
                const x = e.clientX - rect.left - (rect.width / 2);
                const y = e.clientY - rect.top - (rect.height / 2);
                
                const strength = magnet.dataset.strength || 15;
                magnet.style.transform = `translate(${x / strength}px, ${y / strength}px)`;
            });

            magnet.addEventListener('mouseleave', () => {
                magnet.style.transform = 'translate(0, 0)';
            });
        });
    }

    /**
     * Efecto de escritura en vivo para el cuadro de código del Hero
     */
    function initCodeTypingEffect() {
        const codeContainer = document.querySelector('.mockup-code');
        if (!codeContainer) return;

        const originalHTML = codeContainer.innerHTML;

        // Extraer todos los nodos de texto de forma recursiva
        function getTextNodes(node) {
            let textNodes = [];
            if (node.nodeType === Node.TEXT_NODE) {
                textNodes.push(node);
            } else {
                for (let child of node.childNodes) {
                    textNodes = textNodes.concat(getTextNodes(child));
                }
            }
            return textNodes;
        }

        const textNodes = getTextNodes(codeContainer);
        const texts = textNodes.map(node => {
            const text = node.nodeValue;
            node.nodeValue = '';
            return text;
        });

        let nodeIndex = 0;
        let charIndex = 0;
        const typingSpeed = 8; // velocidad de escritura ultra rápida por letra (8ms)
        const delayBeforeRestart = 4000; // pausa de 4 segundos antes de reiniciar

        function type() {
            if (nodeIndex >= textNodes.length) {
                setTimeout(() => {
                    codeContainer.innerHTML = originalHTML;
                    initCodeTypingEffect();
                }, delayBeforeRestart);
                return;
            }

            const currentNode = textNodes[nodeIndex];
            const currentFullText = texts[nodeIndex];

            // Si es un espacio o salto de línea en blanco, escribir instantáneamente (2ms)
            const currentSpeed = (currentFullText.trim() === '') ? 2 : typingSpeed;

            if (charIndex < currentFullText.length) {
                currentNode.nodeValue += currentFullText.charAt(charIndex);
                charIndex++;
                setTimeout(type, currentSpeed);
            } else {
                nodeIndex++;
                charIndex = 0;
                setTimeout(type, typingSpeed * 1.5);
            }
        }

        setTimeout(type, 1000);
    }

    /**
     * Rotación física 3D en las tarjetas de servicios (3D Tilt Effect)
     */
    function init3DTilt() {
        const cards = document.querySelectorAll('.service-card-3d, .split-card');
        
        cards.forEach(card => {
            card.addEventListener('mousemove', (e) => {
                if (window.innerWidth < 1024) {
                    card.style.transform = '';
                    return;
                }
                const rect = card.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                
                const xc = rect.width / 2;
                const yc = rect.height / 2;
                
                // Divisor a 12 para hacer la inclinación de presión consistente y fluida
                const angleX = (y - yc) / 12;
                const angleY = (x - xc) / 12;
                
                card.style.transition = 'transform 0.1s cubic-bezier(0.25, 0.46, 0.45, 0.94), box-shadow 0.5s ease';
                card.style.transform = `rotateX(${angleX}deg) rotateY(${angleY}deg) translateZ(0)`;
            });

            card.addEventListener('mouseleave', () => {
                card.style.transform = 'rotateX(0deg) rotateY(0deg) translateZ(0)';
                card.style.transition = 'transform 0.5s ease';
            });

            card.addEventListener('mouseenter', () => {
                if (window.innerWidth < 1024) return;
                card.style.transition = 'transform 0.1s ease-out';
            });
        });
    }

    /**
     * Apilamiento 3D interactivo en la sección de proyectos al hacer scroll
     */
    function initStackingProjectsScroll() {
        const container = document.getElementById('projects-stack-container');
        if (!container) return;

        const updateStacking = () => {
            const cards = container.querySelectorAll('.sticky-stack-card, .stage-card');
            if (cards.length === 0) return;

            const totalCards = cards.length;
            const isMobile = window.innerWidth < 768;
            const stepOffset = isMobile ? 24 : 35;
            const startTop = isMobile ? 80 : 160;

            cards.forEach((card, index) => {
                const baseTop = startTop + (index * stepOffset);
                card.style.top = `${baseTop}px`;

                const overlapThreshold = 220;
                let stackedAbove = 0;

                for (let k = index + 1; k < totalCards; k++) {
                    const nextCard = cards[k];
                    const nextBaseTop = startTop + (k * stepOffset);
                    const nextTop = nextCard.getBoundingClientRect().top;
                    const diff = nextTop - nextBaseTop;

                    if (diff < overlapThreshold) {
                        const progress = Math.max(0, Math.min(1, 1 - (diff / overlapThreshold)));
                        stackedAbove += progress;
                    }
                }

                const innerCard = card.querySelector('.stage-card-inner') || card;
                const currentTop = card.getBoundingClientRect().top;
                if (currentTop <= baseTop + 20) {
                    const targetScale = Math.max(0.78, 1 - (stackedAbove * 0.035));
                    const brightness = Math.max(0.45, 1 - (stackedAbove * 0.1));

                    innerCard.style.transform = `perspective(1200px) scale(${targetScale})`;
                    innerCard.style.filter = `brightness(${Math.round(brightness * 100)}%)`;
                } else {
                    innerCard.style.transform = 'perspective(1200px) scale(1)';
                    innerCard.style.filter = 'brightness(100%)';
                }
            });
        };

        window.addEventListener('scroll', updateStacking, { passive: true });
        window.addEventListener('resize', updateStacking, { passive: true });
        updateStacking();
    }

    /**
     * Inicializa el cursor premium personalizado.
     */
    function initCustomCursor() {
        const cursor = document.getElementById('custom-cursor');
        if (!cursor) return;

        const dot = cursor.querySelector('.cursor-dot');
        const follower = cursor.querySelector('.cursor-follower');
        if (!dot || !follower) return;

        let mouseX = 0, mouseY = 0;
        let followerX = 0, followerY = 0;

        window.addEventListener('mousemove', (e) => {
            if (window.matchMedia('(pointer: coarse)').matches) {
                cursor.style.display = 'none';
                return;
            } else {
                cursor.style.display = 'block';
            }

            mouseX = e.clientX;
            mouseY = e.clientY;

            dot.style.left = `${mouseX}px`;
            dot.style.top = `${mouseY}px`;
        });

        // Suavizado LERP para el aro
        function animateFollower() {
            followerX += (mouseX - followerX) * 0.15;
            followerY += (mouseY - followerY) * 0.15;

            follower.style.left = `${followerX}px`;
            follower.style.top = `${followerY}px`;

            requestAnimationFrame(animateFollower);
        }
        animateFollower();

        bindCursorHoverEvents = function() {
            const interactives = document.querySelectorAll('a, button, input, select, textarea, .interactive, .combo-card, .addon-item, [role="button"], .filter-btn');
            interactives.forEach(el => {
                el.removeEventListener('mouseenter', onMouseEnter);
                el.removeEventListener('mouseleave', onMouseLeave);
                
                el.addEventListener('mouseenter', onMouseEnter);
                el.addEventListener('mouseleave', onMouseLeave);
            });
        };

        function onMouseEnter(e) {
            const el = e.currentTarget;
            document.body.classList.add('cursor-hover');
            if (el.classList.contains('magnet-target') || el.id === 'hero-code-mockup') {
                document.body.classList.add('cursor-hover-code');
            }
        }

        function onMouseLeave() {
            document.body.classList.remove('cursor-hover', 'cursor-hover-code');
        }

        bindCursorHoverEvents();
    }

    /**
     * Inicializa la barra de progreso de scroll superior y efectos de aparición en scroll.
     */
    function initScrollEffects() {
        const progressBar = document.getElementById('scroll-progress');
        
        // 1. Barra de progreso
        window.addEventListener('scroll', () => {
            if (!progressBar) return;
            const totalScroll = document.documentElement.scrollHeight - window.innerHeight;
            if (totalScroll > 0) {
                const progress = (window.scrollY / totalScroll) * 100;
                progressBar.style.width = `${progress}%`;
            }
        });

        // 2. Efecto de aparición al hacer scroll (Intersection Observer)
        const revealElements = document.querySelectorAll('.reveal-on-scroll');
        
        scrollRevealObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('revealed');
                    
                    // Si es un stat-item, disparar el conteo
                    if (entry.target.classList.contains('stat-item')) {
                        const numEl = entry.target.querySelector('.stat-number');
                        if (numEl && !numEl.classList.contains('counted')) {
                            numEl.classList.add('counted');
                            animateStatCounter(numEl);
                        }
                    }
                    
                    scrollRevealObserver.unobserve(entry.target); // Dejar de observar una vez visible
                }
            });
        }, { threshold: 0.05 });

        revealElements.forEach(el => scrollRevealObserver.observe(el));
    }

    /**
     * Anima el conteo incremental progresivo de una estadística usando requestAnimationFrame
     */
    function animateStatCounter(el) {
        const target = +el.getAttribute('data-target');
        const duration = 2500; // 2.5 segundos (más lento y elegante)
        const startTime = performance.now();
        
        function update(currentTime) {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            
            // Easing cuadrático de salida para desaceleración suave
            const easeProgress = progress * (2 - progress);
            const currentVal = Math.floor(easeProgress * target);
            
            const isPercent = el.parentNode.textContent.includes('%');
            el.textContent = currentVal + (isPercent ? '%' : '+');
            
            if (progress < 1) {
                requestAnimationFrame(update);
            } else {
                el.textContent = target + (isPercent ? '%' : '+');
            }
        }
        requestAnimationFrame(update);
    }

    /**
     * Inicializa Lenis Smooth Scroll con soporte de inercia
     */
    function initSmoothScroll() {
        if (typeof Lenis !== 'undefined') {
            const lenis = new Lenis({
                duration: 1.2,
                easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
                direction: 'vertical',
                gestureDirection: 'vertical',
                smooth: true,
                mouseMultiplier: 1.0,
                smoothTouch: false,
                touchMultiplier: 2,
                infinite: false,
            });

            function raf(time) {
                lenis.raf(time);
                requestAnimationFrame(raf);
            }
            requestAnimationFrame(raf);

            // Vinculación de Lenis con los saltos de menú
            document.querySelectorAll('a[href^="#"]').forEach(anchor => {
                anchor.addEventListener('click', function (e) {
                    e.preventDefault();
                    const targetId = this.getAttribute('href');
                    const target = document.querySelector(targetId);
                    if (target) {
                        lenis.scrollTo(target, { offset: -20 });
                    }
                });
            });
        }
    }

    /**
     * Mapea coordenadas del cursor para el brillo radial de fondo en las tarjetas (Glow Effect)
     */
    function initCardGlowTracker() {
        bindCardGlowTracker = function() {
            const glowCards = document.querySelectorAll('.service-card-3d, .sticky-stack-card');
            glowCards.forEach(card => {
                card.removeEventListener('mousemove', onCardMouseMove);
                card.addEventListener('mousemove', onCardMouseMove);
            });
        };

        function onCardMouseMove(e) {
            const card = e.currentTarget;
            const rect = card.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            card.style.setProperty('--mx', `${x}px`);
            card.style.setProperty('--my', `${y}px`);
        }

        bindCardGlowTracker();
    }

    init();
});
