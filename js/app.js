import { getProjects, addProject, deleteProject, updateProject, getCategories, addCategory, deleteCategory } from "./projects.js";

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
    const btnQuoteMail = document.getElementById("btn-quote-mail");

    // Formulario de contacto
    const contactForm = document.getElementById("contact-form");
    const contactName = document.getElementById("contact-name");

    // Variables de Estado
    let uploadedImageBase64 = "";
    let isEditMode = false;
    let editingProjectId = null;

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
    function renderPortfolio(filter = "all") {
        portfolioGrid.innerHTML = "";
        const projects = getProjects();

        const filteredProjects = filter === "all" 
            ? projects 
            : projects.filter(p => p.category === filter);

        if (filteredProjects.length === 0) {
            portfolioGrid.innerHTML = `
                <div class="glass text-center w-full" style="grid-column: 1/-1; padding: 40px;">
                    <p style="color: var(--text-secondary);">No hay proyectos cargados en esta categoría.</p>
                </div>
            `;
            return;
        }

        filteredProjects.forEach(proj => {
            const card = document.createElement("div");
            card.className = "project-card glass";
            card.style.opacity = "0";
            card.style.transform = "scale(0.95)";
            card.style.transition = "opacity 0.4s ease, transform 0.4s ease";

            // Creación de tags HTML
            const tagsHTML = proj.tags.map(t => `<span class="tag">${t.trim()}</span>`).join("");

            card.innerHTML = `
                <div class="project-image-box">
                    <img src="${proj.image}" alt="${proj.title}" loading="lazy">
                    <div class="project-overlay">
                        <div class="project-tags">${tagsHTML}</div>
                    </div>
                </div>
                <div class="project-info">
                    <span class="project-category">${getCategoryLabel(proj.category)}</span>
                    <h3>${proj.title}</h3>
                    <p>${proj.description}</p>
                    <a href="${proj.demoUrl || '#'}" target="_blank" rel="noopener" class="project-link">
                        Visitar demo
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
                    </a>
                </div>
            `;

            portfolioGrid.appendChild(card);
            
            // Micro-delay para disparar animación
            setTimeout(() => {
                card.style.opacity = "1";
                card.style.transform = "scale(1)";
            }, 50);
        });
    }

    function getCategoryLabel(catId) {
        const cat = getCategories().find(c => c.id === catId);
        return cat ? cat.label : "Web";
    }

    // Renderizar Filtros del Portfolio dinámicamente
    function renderFilters() {
        const activeBtn = filterWrapper.querySelector(".filter-btn.active");
        const activeFilter = activeBtn ? activeBtn.dataset.filter : "all";

        filterWrapper.innerHTML = `<button class="filter-btn" data-filter="all">Todos</button>`;
        const categories = getCategories();
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
    function renderCategoryDropdown() {
        const currentSelected = projCategorySelect.value;
        projCategorySelect.innerHTML = "";
        const categories = getCategories();
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
    // 5. Panel de Administración (Local Storage)
    // ==========================================================================
    const openAdminModal = () => {
        adminModal.classList.add("open");
        adminModalOverlay.classList.add("open");
        mobileDrawer.classList.remove("open");
        drawerOverlay.classList.remove("open");

        // Comprobación si ya se logueó esta sesión
        if (sessionStorage.getItem("admin_logged_in") === "true") {
            showAdminDashboard();
        } else {
            showPasswordScreen();
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
        adminPasswordInput.value = "";
        passwordError.textContent = "";
    }

    function showAdminDashboard() {
        adminPasswordScreen.classList.add("hidden");
        adminDashboardContent.classList.remove("hidden");
        renderAdminProjectsList();
        renderAdminCategoriesList();
    }

    // Enviar clave
    btnSubmitPassword.addEventListener("click", () => {
        if (adminPasswordInput.value === "admin123") {
            sessionStorage.setItem("admin_logged_in", "true");
            showAdminDashboard();
        } else {
            passwordError.textContent = "Clave incorrecta. Intente con 'admin123'.";
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
    adminAddProjectForm.addEventListener("submit", (e) => {
        e.preventDefault();

        // Validaciones
        const title = projTitleInput.value.trim();
        const category = projCategorySelect.value;
        const demoUrl = projDemoInput.value.trim() || "#";
        const tags = projTagsInput.value.split(",").map(t => t.trim()).filter(t => t !== "");
        const description = projDescInput.value.trim();

        if (!title || !description) {
            alert("Por favor completa los campos requeridos.");
            return;
        }

        let projectImage = uploadedImageBase64;
        if (!projectImage) {
            // Si estamos editando y no se subió una nueva imagen, conservamos la actual
            if (isEditMode) {
                const existingProj = getProjects().find(p => p.id === editingProjectId);
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
            updateProject(projectData);
            exitEditMode();
            alert("¡Proyecto actualizado con éxito!");
        } else {
            addProject(projectData);
            resetAdminForm();
            alert("¡Proyecto agregado con éxito!");
        }

        renderAdminProjectsList();
        
        // Obtener filtro activo en portfolio y refrescar
        const activeFilterBtn = document.querySelector(".filter-btn.active");
        renderPortfolio(activeFilterBtn ? activeFilterBtn.dataset.filter : "all");
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

    // Renderizar la lista de edición/borrado en Admin
    function renderAdminProjectsList() {
        adminProjectsList.innerHTML = "";
        const projects = getProjects();

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
            btn.addEventListener("click", () => {
                const id = btn.dataset.id;
                const proj = getProjects().find(p => p.id === id);
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
            btn.addEventListener("click", (e) => {
                const id = btn.dataset.id;
                const projName = btn.parentElement.parentElement.querySelector(".admin-project-name").textContent;
                
                if (confirm(`¿Estás seguro de eliminar el proyecto "${projName}"?`)) {
                    deleteProject(id);
                    if (isEditMode && editingProjectId === id) {
                        exitEditMode();
                    }
                    renderAdminProjectsList();
                    // Refrescar portfolio general
                    const activeFilterBtn = document.querySelector(".filter-btn.active");
                    renderPortfolio(activeFilterBtn ? activeFilterBtn.dataset.filter : "all");
                }
            });
        });
    }

    // ==========================================================================
    // 6. Cotizador Interactivo de Presupuestos
    // ==========================================================================
    function calculateQuotation() {
        let total = 0;
        let totalTime = 0;
        
        // 1. Obtener combo seleccionado
        const activeComboCard = document.querySelector(".combo-card.active");
        if (!activeComboCard) return;

        const comboName = activeComboCard.querySelector("h4").textContent;
        const comboBasePrice = parseInt(activeComboCard.dataset.price);
        const comboBaseTime = parseInt(activeComboCard.dataset.time);

        total += comboBasePrice;
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

                total += addonPrice;
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

        // 3. Escribir resultados finales en la tarjeta resumen
        sumDeliveryTime.textContent = `${totalTime} días hábiles`;
        sumTotalPrice.textContent = `$${total} USD`;
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

        const total = sumTotalPrice.textContent;
        const time = sumDeliveryTime.textContent;

        const text = `Hola Ariel! Me contacto desde tu portfolio web. Mi nombre es *${clientName}*.\n\n` +
            `Me gustaría solicitar un presupuesto estimado basado en tu cotizador online:\n\n` +
            `🔹 *Combo seleccionado:* ${comboName} ($${comboBasePrice} USD)\n` +
            `➕ *Adicionales elegidos:*\n${addonsText}\n` +
            `🕒 *Tiempo de entrega estimado:* ${time}\n` +
            `💰 *PRESUPUESTO TOTAL ESTIMADO:* ${total}\n\n` +
            `Quedo atento/a para que podamos coordinar los detalles. ¡Gracias!`;

        return text;
    }

    // Botón de WhatsApp
    btnQuoteWhatsapp.addEventListener("click", () => {
        const message = generateQuotationText();
        const encodedMessage = encodeURIComponent(message);
        
        // Número de WhatsApp de destino (reemplazable por el usuario)
        const phoneNumber = "543516121498"; 
        
        const whatsappUrl = `https://wa.me/${phoneNumber}?text=${encodedMessage}`;
        window.open(whatsappUrl, "_blank");
    });

    // Botón de Email
    btnQuoteMail.addEventListener("click", () => {
        const messageText = generateQuotationText();
        const subject = encodeURIComponent("Solicitud de Cotización Web - Ariel.Dev");
        const body = encodeURIComponent(messageText.replace(/\*/g, "")); // Quitar asteriscos de formato de WhatsApp
        
        const mailToUrl = `mailto:arielmartinelli2019@gmail.com?subject=${subject}&body=${body}`;
        window.open(mailToUrl, "_blank");
    });

    // Formulario de Contacto General
    contactForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const name = contactName.value.trim();
        const email = document.getElementById("contact-email").value.trim();
        const subject = document.getElementById("contact-subject").value.trim();
        const message = document.getElementById("contact-message").value.trim();

        if (!name || !email || !subject || !message) {
            alert("Por favor, completa todos los campos del formulario.");
            return;
        }

        // Mensaje de éxito de simulación
        alert(`¡Gracias por tu mensaje, ${name}! Se ha enviado la consulta con éxito. Ariel se pondrá en contacto a la brevedad.`);
        contactForm.reset();
    });

    // Agregar nueva categoría
    btnAddCategory.addEventListener("click", () => {
        const label = newCategoryInput.value.trim();
        if (!label) {
            alert("Por favor escribe un nombre para la categoría.");
            return;
        }

        const res = addCategory(label);
        if (res.error) {
            alert(res.error);
        } else {
            newCategoryInput.value = "";
            renderFilters();
            renderCategoryDropdown();
            renderAdminCategoriesList();
            alert(`Categoría "${label}" agregada con éxito.`);
        }
    });

    newCategoryInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
            btnAddCategory.click();
        }
    });

    // Renderizar la lista de categorías en Admin
    function renderAdminCategoriesList() {
        adminCategoriesList.innerHTML = "";
        const categories = getCategories();
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
            btn.addEventListener("click", () => {
                const id = btn.dataset.id;
                const catName = btn.parentElement.querySelector(".admin-category-name").textContent;
                if (confirm(`¿Estás seguro de eliminar la categoría "${catName}"?`)) {
                    const res = deleteCategory(id);
                    if (res.error) {
                        alert(res.error);
                    } else {
                        renderFilters();
                        renderCategoryDropdown();
                        renderAdminCategoriesList();
                        renderPortfolio();
                    }
                }
            });
        });
    }

    // ==========================================================================
    // 8. Inicialización al cargar la página
    // ==========================================================================
    renderFilters();
    renderCategoryDropdown();
    renderPortfolio();
    calculateQuotation();
});
