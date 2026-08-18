import Lenis from "lenis";
import { getProjects, getCategories } from "./projects.js";
import { supabase, isSupabaseConfigured } from "./supabase.js";
import { configurarDialogos, confirmar, avisar } from "./ui-dialogs.js";
import { obtenerResenasPublicas } from "./reviews.js";
import {
    escapeHtml,
    safeUrl,
    safeImageSrc,
    sanitizeText,
    isValidEmail,
    LIMITS,
} from "./security.js";

/**
 * Carga html2pdf (885 KB) bajo demanda, una sola vez.
 * Antes se descargaba en cada visita aunque nadie exportara un presupuesto.
 * Se sirve desde el propio dominio, no desde un CDN externo: así la CSP puede
 * mantener script-src acotado y no dependemos de la disponibilidad de terceros.
 */
/** Detecta pantalla táctil chica: cambia cómo se abren enlaces y se descarga. */
function esMovil() {
    return window.matchMedia("(max-width: 900px)").matches
        || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

/**
 * iOS ignora el atributo `download` de los enlaces: no descarga el archivo,
 * lo abre. Necesita un flujo distinto (ver descargarPdf).
 */
function esIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent)
        || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

let html2pdfPromise = null;
function loadHtml2Pdf() {
    if (window.html2pdf) return Promise.resolve(window.html2pdf);
    if (html2pdfPromise) return html2pdfPromise;

    html2pdfPromise = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "/html2pdf.bundle.min.js";
        script.onload = () => resolve(window.html2pdf);
        script.onerror = () => {
            html2pdfPromise = null; // permite reintentar si falló la red
            reject(new Error("No se pudo cargar html2pdf."));
        };
        document.head.appendChild(script);
    });
    return html2pdfPromise;
}

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

    // El panel de administración se mudó a /admin: acá ya no hay ningún
    // elemento suyo que referenciar.
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
    }, { passive: true });

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

            // BUG CORREGIDO: la opacidad se ponía en 0 y solo volvía a 1 al
            // terminar de pintar. Si Supabase tardaba o no respondía, el bloque
            // quedaba INVISIBLE y en blanco, sin ninguna señal de que algo
            // estaba pasando: parecía que el portfolio no existía.
            //
            // El aviso se pone AHORA, de forma síncrona, y no con un
            // setTimeout: si el visitante toca dos filtros seguidos, la
            // segunda pasada limpia el contenedor y un aviso diferido de la
            // primera nunca llegaría a mostrarse, dejando el hueco vacío.
            container.innerHTML = `
                <div class="glass text-center w-full" style="padding: 40px; border-radius: 28px;">
                    <p style="color: var(--text-secondary);">Cargando proyectos…</p>
                </div>`;
            container.style.opacity = "1";

            let projects;
            try {
                projects = await getProjects();
            } catch (err) {
                console.error("No se pudieron cargar los proyectos:", err?.message || err);
                projects = [];
            }

            container.innerHTML = "";

            if (!Array.isArray(projects) || projects.length === 0) {
                container.innerHTML = `
                    <div class="glass text-center w-full" style="padding: 40px; border-radius: 28px;">
                        <p style="color: var(--text-secondary);">No se pudieron cargar los proyectos en este momento.</p>
                    </div>`;
                container.style.opacity = "1";
                return;
            }

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
                // Todo dato de proyecto proviene de la base y debe tratarse como
                // no confiable: se escapa en contexto HTML y se validan los esquemas de URL.
                const safeImgSrc = escapeHtml(safeImageSrc(proj.image));
                const safeTitle = escapeHtml(proj.title);
                const safeDemoUrl = safeUrl(proj.demoUrl);
                const tagsHTML = (proj.tags || [])
                    .slice(0, LIMITS.TAGS_COUNT)
                    .map(t => `<span class="tag">${escapeHtml(String(t).trim().slice(0, LIMITS.TAG))}</span>`)
                    .join("");
                const demoLinkHTML = safeDemoUrl && safeDemoUrl !== '#' ? `
                    <a href="${escapeHtml(safeDemoUrl)}" target="_blank" rel="noopener noreferrer" class="stack-card-link">
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
                            <span class="stack-card-tag">${escapeHtml(getCategoryLabel(proj.category))}</span>
                            <h3 class="stack-card-title">${safeTitle}</h3>
                            <p class="stack-card-desc">${escapeHtml(proj.description)}</p>
                            <div style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 24px;">${tagsHTML}</div>
                            ${demoLinkHTML}
                        </div>
                        <div class="stage-img-box">
                            <img src="${safeImgSrc}" alt="${safeTitle}" class="stage-img" loading="lazy" decoding="async" onerror="this.style.display='none'">
                        </div>
                    </div>
                `;

                container.appendChild(card);

                if (scrollRevealObserver) {
                    scrollRevealObserver.observe(card);
                }
            });

            container.style.opacity = "1";

            // Generar dots de navegación para vista móvil (slider horizontal)
            let dotsContainer = document.getElementById("projects-mobile-dots");
            if (!dotsContainer && container.parentNode) {
                dotsContainer = document.createElement("div");
                dotsContainer.id = "projects-mobile-dots";
                dotsContainer.className = "projects-mobile-dots";
                container.parentNode.appendChild(dotsContainer);
            }

            if (dotsContainer) {
                if (filteredProjects.length > 1) {
                    dotsContainer.style.display = "";
                    dotsContainer.innerHTML = filteredProjects.map((_, idx) => `
                        <button class="mobile-dot ${idx === 0 ? 'active' : ''}" data-index="${idx}" aria-label="Ver proyecto ${idx + 1}"></button>
                    `).join("");

                    dotsContainer.querySelectorAll(".mobile-dot").forEach(dot => {
                        dot.addEventListener("click", () => {
                            const index = parseInt(dot.dataset.index);
                            const cards = container.querySelectorAll(".stage-card");
                            if (cards[index]) {
                                cards[index].scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" });
                            }
                        });
                    });

                    const syncMobileDots = () => {
                        if (window.innerWidth >= 768) return;
                        const cards = container.querySelectorAll(".stage-card");
                        const containerLeft = container.getBoundingClientRect().left;
                        let activeIdx = 0;
                        let minDiff = Infinity;
                        cards.forEach((card, idx) => {
                            const diff = Math.abs(card.getBoundingClientRect().left - containerLeft);
                            if (diff < minDiff) {
                                minDiff = diff;
                                activeIdx = idx;
                            }
                        });
                        dotsContainer.querySelectorAll(".mobile-dot").forEach((d, idx) => {
                            d.classList.toggle("active", idx === activeIdx);
                        });
                    };

                    container.removeEventListener("scroll", container._syncDots);
                    container._syncDots = syncMobileDots;
                    container.addEventListener("scroll", syncMobileDots, { passive: true });
                } else {
                    dotsContainer.style.display = "none";
                }
            }

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
        if (!filterWrapper) return;
        const activeBtn = filterWrapper.querySelector(".filter-btn.active");
        const activeFilter = activeBtn ? activeBtn.dataset.filter : "all";

        filterWrapper.innerHTML = `<button class="filter-btn" data-filter="all">Todos</button>`;
        const categories = await getCategories();
        cachedCategories = categories; // Actualizar caché
        categories.forEach(cat => {
            filterWrapper.innerHTML += `<button class="filter-btn" data-filter="${escapeHtml(cat.id)}">${escapeHtml(cat.label)}</button>`;
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

    // ==========================================================================
    // 5. Panel de Administración — MUDADO A /admin
    //
    //    Todo el ABM de proyectos, categorías y clientes vive ahora en
    //    admin.html + js/admin*.js. Este archivo solo maneja el sitio público.
    //
    //    Por qué se movió:
    //      - El modal obligaba a scrollear una caja dentro de otra caja, y ese
    //        scroll interno quedaba bloqueado por Lenis (el scroll suave).
    //      - Cuatro secciones con tablas no entran en una tarjeta de 900px.
    //      - Este bundle lo baja CUALQUIER visitante: cargar acá el panel era
    //        hacerle pagar a todo el mundo un código que casi nadie usa.
    // ==========================================================================
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
                const safeAddon = escapeHtml(addonName);
                li.innerHTML = `
                    <span class="add-item-name" title="${safeAddon}">${safeAddon}</span>
                    <span>+$${Number.isFinite(addonPrice) ? addonPrice : 0} USD</span>
                `;
                sumAddonsList.appendChild(li);
            }
        });

        if (!hasAddons) {
            sumAddonsList.innerHTML = `<li class="no-addons">Ningún adicional seleccionado</li>`;
        }

        // 3. Evaluar método de pago (3 cuotas SIN interés: el total no cambia)
        const isInstallments = payInstallmentsRadio && payInstallmentsRadio.checked;
        let finalTotalUsd = baseTotal;
        
        if (isInstallments) {
            // Sin interés: el total financiado es igual al total al contado.
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
    /**
     * Pide el nombre del cliente antes de generar el presupuesto.
     * Lo usan tanto el envío por WhatsApp como la descarga del PDF, para que
     * ambos se comporten igual. Precarga el valor del formulario de contacto
     * si ya lo completó.
     */
    async function pedirNombreCliente(textoConfirmar) {
        const { value, isConfirmed } = await Swal.fire({
            title: "¿A nombre de quién?",
            input: "text",
            inputLabel: "Nombre o empresa para el presupuesto",
            inputPlaceholder: "Ej: Juan Pérez / Empresa SRL",
            inputValue: contactName.value.trim() || "",
            showCancelButton: true,
            confirmButtonText: textoConfirmar,
            cancelButtonText: "Cancelar",
            confirmButtonColor: "#6366f1",
            inputValidator: (v) => (!v || !v.trim()) ? "Por favor ingresá un nombre." : undefined,
        });

        if (!isConfirmed || !value) return null;
        return sanitizeText(value, LIMITS.NAME);
    }

    function generateQuotationText(clientName) {

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
            
            paymentText = `💳 *Forma de pago:* 3 Cuotas sin interés\n` +
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
    btnQuoteWhatsapp.addEventListener("click", async () => {
        const clientName = await pedirNombreCliente("Enviar por WhatsApp");
        if (!clientName) return;

        const message = generateQuotationText(clientName);
        const encodedMessage = encodeURIComponent(message);
        const phoneNumber = "543516121498";
        const whatsappUrl = `https://wa.me/${phoneNumber}?text=${encodedMessage}`;

        // En móvil, window.open tras un await suele quedar bloqueado por el
        // navegador (se perdió la interacción del usuario). Navegar en la misma
        // pestaña siempre funciona: WhatsApp abre su propia app igual.
        if (esMovil()) {
            window.location.href = whatsappUrl;
        } else {
            // noopener/noreferrer: impide que la pestaña destino acceda a window.opener.
            window.open(whatsappUrl, "_blank", "noopener,noreferrer");
        }
    });



    // Botón de PDF
    if (btnQuotePdf) {
        // La librería empieza a bajar apenas el usuario toca el botón, en
        // paralelo con el diálogo del nombre. Así ya está lista cuando confirma
        // y la descarga no se demora — que es lo que hacía fallar en móvil.
        btnQuotePdf.addEventListener("pointerdown", () => {
            loadHtml2Pdf().catch(() => { /* se reintenta al confirmar */ });
        }, { once: true });

        btnQuotePdf.addEventListener("click", async () => {
            const clientName = await pedirNombreCliente("Generar PDF");
            if (!clientName) return;

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
            const finalTotalUsd = baseTotal;
            let installmentsMarkup = "";

            if (isInstallments) {
                // Sin interés: el total financiado es igual al total al contado,
                // así que no hay fila de recargo en el presupuesto.
                const installmentUsd = (finalTotalUsd / 3).toFixed(2);
                const installmentArs = Math.round((finalTotalUsd * dollarRate) / 3).toLocaleString("es-AR");
                
                installmentsMarkup = `
                    <div class="installments-box">
                        <div class="installments-icon">💳</div>
                        <div>
                            <strong>Financiación en 3 cuotas sin interés</strong>
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

                    /* ── Footer ── */
                    .pdf-footer {
                        border-top: 2px solid #e2e8f0;
                        padding-top: 12px;
                        margin-top: 15px;
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
                                <p style="font-weight: 600; font-size: 1rem; color: #0f172a;">${escapeHtml(clientName)}</p>
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

                        <!-- Footer -->
                        <div class="pdf-footer">
                            <div>
                                <p>Email: <span>ariel.martinelli.dev@gmail.com</span></p>
                                <p>WhatsApp: <span>+54 351 612 1498</span></p>
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

            // Se neutraliza el nombre de archivo: evita path traversal y caracteres inválidos.
            const safeFilePart = clientName.replace(/[^\p{L}\p{N}_-]+/gu, "_").slice(0, 60) || "Cliente";
            const pdfFilename = `Presupuesto_ArielDev_${safeFilePart}.pdf`;
            const opt = {
                margin:       0,
                filename:     pdfFilename,
                image:        { type: 'jpeg', quality: 0.98 },
                html2canvas:  {
                    // scale 2 en un celular genera un lienzo enorme y el
                    // navegador puede quedarse sin memoria y fallar sin aviso.
                    scale: esMovil() ? 1.5 : 2,
                    useCORS: true,
                    logging: false,
                    scrollX: 0,
                    scrollY: 0,
                    x: 0,
                    y: 0,
                    windowWidth: 750
                },
                pagebreak:    { mode: 'avoid-all' },
                jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
            };

            Swal.fire({
                title: "Generando tu presupuesto...",
                allowOutsideClick: false,
                didOpen: () => Swal.showLoading(),
            });

            try {
                await loadHtml2Pdf();

                // Se genera el PDF en memoria y se entrega a mano, en vez de
                // usar .save(). Así se puede adaptar la entrega a cada
                // plataforma en lugar de depender del comportamiento interno
                // de jsPDF, que en móvil no siempre dispara la descarga.
                const blob = await html2pdf().set(opt).from(tempDiv).outputPdf("blob");
                const url = URL.createObjectURL(blob);

                if (esIOS()) {
                    // iOS ignora el atributo `download`. Se ofrece un enlace
                    // para que el usuario lo toque: ese gesto real es lo que
                    // permite abrir el archivo sin que Safari lo bloquee.
                    Swal.fire({
                        icon: "success",
                        title: "Presupuesto listo",
                        html: `<p>Tocá el botón para abrirlo y luego usá <strong>Compartir → Guardar en Archivos</strong>.</p>
                               <a href="${url}" target="_blank" rel="noopener noreferrer"
                                  class="btn btn-primary" style="margin-top:12px; display:inline-block;">
                                  Abrir presupuesto
                               </a>`,
                        showConfirmButton: false,
                        showCloseButton: true,
                    });
                } else {
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = pdfFilename;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    Swal.close();
                }

                // Se libera la memoria del blob, dando margen para la descarga.
                setTimeout(() => URL.revokeObjectURL(url), 120000);
            } catch (err) {
                console.error("Error al descargar PDF:", err?.message || err);
                Swal.fire({
                    icon: "error",
                    title: "No se pudo generar el PDF",
                    text: "Podés pedirme el presupuesto por WhatsApp mientras tanto.",
                });
            } finally {
                if (container.parentNode) document.body.removeChild(container);
            }
        });
    }

    // ==========================================================================
    // Formulario de Contacto (FUNC-01)
    //
    // Si VITE_FORMSPREE_ID está definido, el mensaje se envía por email.
    // Si no lo está, degrada solo a WhatsApp — nunca se muestra "enviado"
    // sin haber enviado, que era el problema original.
    // ==========================================================================
    const FORMSPREE_ID = import.meta.env.VITE_FORMSPREE_ID || "";
    const WHATSAPP_NUMBER = "543516121498";

    /** Última marca de tiempo de envío, para frenar clics repetidos. */
    let lastContactSubmit = 0;

    function abrirWhatsAppContacto({ name, email, subject, message }) {
        const body =
            `Hola Ariel! Consulta desde el portfolio.\n\n` +
            `Nombre: ${name}\n` +
            `Email: ${email}\n` +
            `Asunto: ${subject}\n\n${message}`;
        window.open(
            `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(body)}`,
            "_blank",
            "noopener,noreferrer"
        );
    }

    contactForm.addEventListener("submit", async (e) => {
        e.preventDefault();

        const name = sanitizeText(contactName.value, LIMITS.NAME);
        const email = document.getElementById("contact-email").value.trim();
        const subject = sanitizeText(document.getElementById("contact-subject").value, LIMITS.SUBJECT);
        const message = sanitizeText(document.getElementById("contact-message").value, LIMITS.MESSAGE);
        const gotcha = document.getElementById("contact-gotcha")?.value || "";

        // Honeypot: si este campo oculto viene lleno, es un bot.
        // Se simula éxito para no darle información sobre por qué falló.
        if (gotcha) {
            contactForm.reset();
            Swal.fire("¡Gracias!", "Tu mensaje fue enviado.", "success");
            return;
        }

        if (!name || !email || !subject || !message) {
            Swal.fire("Atención", "Por favor, completa todos los campos del formulario.", "warning");
            return;
        }

        if (!isValidEmail(email)) {
            Swal.fire("Email inválido", "Revisá la dirección de correo ingresada.", "warning");
            return;
        }

        // Freno básico: un envío cada 15 segundos desde el mismo navegador.
        // No reemplaza al control de Formspree, solo evita el doble clic.
        const ahora = Date.now();
        if (ahora - lastContactSubmit < 15000) {
            Swal.fire("Esperá unos segundos", "Ya enviaste una consulta recién.", "info");
            return;
        }

        const datos = { name, email, subject, message };

        // Sin Formspree configurado: WhatsApp, avisando con claridad.
        if (!FORMSPREE_ID) {
            abrirWhatsAppContacto(datos);
            lastContactSubmit = ahora;
            Swal.fire("¡Gracias!", "Se abrió WhatsApp con tu consulta lista para enviar. Confirmá el envío para que me llegue.", "success");
            contactForm.reset();
            return;
        }

        const submitBtn = contactForm.querySelector('button[type="submit"]');
        const textoOriginal = submitBtn ? submitBtn.textContent : "";
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = "Enviando...";
        }

        try {
            const res = await fetch(`https://formspree.io/f/${FORMSPREE_ID}`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Accept: "application/json" },
                body: JSON.stringify({
                    name,
                    email,
                    subject,
                    message,
                    _subject: `Portfolio — ${subject}`,
                }),
            });

            if (!res.ok) throw new Error(`Formspree respondió ${res.status}`);

            lastContactSubmit = ahora;
            contactForm.reset();
            Swal.fire("¡Mensaje enviado!", "Gracias por escribirme. Te respondo en menos de 24 horas.", "success");
        } catch (err) {
            // Falla el envío: en vez de perder la consulta, se ofrece WhatsApp.
            console.error("Error enviando el formulario:", err?.message || err);
            const { isConfirmed } = await Swal.fire({
                title: "No se pudo enviar",
                text: "Hubo un problema con el envío. ¿Querés mandármelo por WhatsApp?",
                icon: "error",
                showCancelButton: true,
                confirmButtonText: "Enviar por WhatsApp",
                cancelButtonText: "Cancelar",
                confirmButtonColor: "#6366f1",
            });
            if (isConfirmed) {
                abrirWhatsAppContacto(datos);
                contactForm.reset();
            }
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = textoOriginal;
            }
        }
    });

    async function renderizarResenasPublicas() {
        const cont = document.getElementById("grid-resenas-publicas");
        if (!cont) return;

        try {
            const resenas = await obtenerResenasPublicas();
            if (!resenas || resenas.length === 0) {
                cont.innerHTML = `<p style="text-align:center; color:var(--text-secondary); width:100%;">Próximamente más testimonios.</p>`;
                return;
            }

            cont.innerHTML = resenas.map((r, idx) => {
                const commentText = (r.comment || "").trim();
                const esLargo = commentText.length > 95;

                return `
                    <div class="resena-card-item">
                        <div class="resena-card-inner glass" id="resena-card-${idx}">
                            <div class="resena-top-box">
                                <div class="resena-stars">
                                    ${"★".repeat(r.rating || 5)}${"☆".repeat(5 - (r.rating || 5))}
                                </div>
                                <p class="resena-comment">
                                    "${escapeHtml(commentText)}"
                                </p>
                                ${esLargo ? `
                                    <button type="button" class="resena-ver-mas-btn" data-target="${idx}">
                                        Ver más
                                    </button>
                                ` : ''}
                            </div>

                            <div class="resena-author-box">
                                <div class="resena-author-info">
                                    <strong class="resena-author-name">${escapeHtml(r.client_name)}</strong>
                                    <span class="resena-author-project">${r.project_name ? escapeHtml(r.project_name) : 'Cliente Satisfecho'}</span>
                                </div>
                                ${(r.company_url && r.company_url.trim().length > 0) ? `
                                    <a href="${safeUrl(r.company_url, '#')}" target="_blank" rel="noopener noreferrer" class="resena-company-link">
                                        Ver página ↗
                                    </a>
                                ` : ''}
                            </div>
                        </div>
                    </div>
                `;
            }).join("");

            // Lógica de despliegue "Ver más" / "Ver menos"
            cont.querySelectorAll(".resena-ver-mas-btn").forEach((btn) => {
                btn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    const idx = btn.dataset.target;
                    const card = document.getElementById(`resena-card-${idx}`);
                    if (!card) return;
                    const estaExpandido = card.classList.contains("expandido");
                    
                    if (estaExpandido) {
                        card.classList.remove("expandido");
                        btn.textContent = "Ver más";
                    } else {
                        // Contraer otras expandidas para mantener formato uniforme
                        cont.querySelectorAll(".resena-card-inner.expandido").forEach(c => c.classList.remove("expandido"));
                        cont.querySelectorAll(".resena-ver-mas-btn").forEach(b => b.textContent = "Ver más");
                        
                        card.classList.add("expandido");
                        btn.textContent = "Ver menos";
                    }
                });
            });

            // Función para contraer tarjetas desplegadas al deslizar
            const contraerExpandidas = () => {
                cont.querySelectorAll(".resena-card-inner.expandido").forEach(c => c.classList.remove("expandido"));
                cont.querySelectorAll(".resena-ver-mas-btn").forEach(b => b.textContent = "Ver más");
            };

            // Conectar botones de navegación con BUCLE INFINITO (Infinite Loop)
            const prevBtn = document.getElementById("resenas-btn-prev");
            const nextBtn = document.getElementById("resenas-btn-next");

            if (prevBtn && !prevBtn.dataset.bound) {
                prevBtn.dataset.bound = "true";
                prevBtn.addEventListener("click", () => {
                    contraerExpandidas();
                    const card = cont.querySelector(".resena-card-item");
                    const scrollAmount = card ? card.getBoundingClientRect().width + 20 : 320;
                    const atStart = cont.scrollLeft <= 15;

                    if (atStart) {
                        // Si está en la primera, vuelve al final (bucle infinito)
                        cont.scrollTo({ left: cont.scrollWidth, behavior: "smooth" });
                    } else {
                        cont.scrollBy({ left: -scrollAmount, behavior: "smooth" });
                    }
                });
            }

            if (nextBtn && !nextBtn.dataset.bound) {
                nextBtn.dataset.bound = "true";
                nextBtn.addEventListener("click", () => {
                    contraerExpandidas();
                    const card = cont.querySelector(".resena-card-item");
                    const scrollAmount = card ? card.getBoundingClientRect().width + 20 : 320;
                    const maxScroll = cont.scrollWidth - cont.clientWidth;
                    const atEnd = cont.scrollLeft >= maxScroll - 15;

                    if (atEnd) {
                        // Si llegó a la última, vuelve al inicio (bucle infinito)
                        cont.scrollTo({ left: 0, behavior: "smooth" });
                    } else {
                        cont.scrollBy({ left: scrollAmount, behavior: "smooth" });
                    }
                });
            }
        } catch (err) {
            console.error("Error cargando reseñas públicas:", err);
        }
    }

    // ==========================================================================
    // 8. Inicialización al cargar la página
    // ==========================================================================
    async function init() {
        // Primero de todo: dejar SweetAlert2 en la capa correcta. Si algo falla
        // más abajo, al menos el cartel de error se va a ver.
        configurarDialogos();

        // ------------------------------------------------------------------
        // BUG CORREGIDO: el orden importaba y estaba al revés.
        //
        // Antes esto empezaba con `await getCategories()` y `await
        // fetchDollarRate()`, y recién DESPUÉS arrancaba el scroll suave, el
        // tilt 3D y los efectos de scroll. Consecuencia: si Supabase estaba
        // lento, caído o mal configurado, esos awaits colgaban la función y
        // los efectos NO se inicializaban nunca. La página quedaba "muerta"
        // por un problema de red que no tiene nada que ver con la animación.
        //
        // Ahora todo lo que NO depende de la red arranca primero y de forma
        // síncrona. Los datos se piden después, en paralelo, y un fallo ahí
        // solo afecta a la sección que los necesita.
        // ------------------------------------------------------------------
        initSmoothScroll();
        initScrollEffects();
        initMagnetEffect();
        initCodeTypingEffect();
        init3DTilt();
        initStackingProjectsScroll();
        renderizarResenasPublicas();
        // initCustomCursor();      // Desactivado
        // initCardGlowTracker();   // Desactivado — CSS vars en cada mousemove

        // Los datos van en paralelo: el portfolio y la cotización del dólar no
        // dependen entre sí, y esperarlos en fila duplica el tiempo de carga.
        // Cada uno atrapa su propio error para que uno caído no tumbe al otro.
        await Promise.all([
            (async () => {
                cachedCategories = await getCategories();
                await renderFilters();
                await renderPortfolio();
            })().catch((e) => console.error("No se pudo cargar el portfolio:", e?.message || e)),

            fetchDollarRate().catch((e) => console.error("No se pudo cotizar el dólar:", e?.message || e)),
        ]);

        // Redirección de "Beneficios de Tener"
        const btnVerVentajas = document.getElementById("btn-ver-ventajas");
        const selectServicio = document.getElementById("select-servicio");
        if (btnVerVentajas && selectServicio) {
            // El elemento ya es un <a> con href válido. El JS solo sincroniza
            // el destino con la opción elegida; la navegación la hace el
            // navegador. Si el JS falla, el enlace sigue llevando a algún lado.
            const SERVICIOS_VALIDOS = ["landing", "ecommerce", "portfolio", "desarrollo-medida", "invitaciones"];

            const sincronizarDestino = () => {
                const service = selectServicio.value;
                if (SERVICIOS_VALIDOS.includes(service)) {
                    btnVerVentajas.href = `ventajas-${service}.html`;
                }
            };

            sincronizarDestino();
            selectServicio.addEventListener("change", sincronizarDestino);
        }

        // El portfolio se acaba de renderizar: hay que re-vincular los efectos
        // a las tarjetas nuevas, que no existían cuando corrió init3DTilt().
        if (typeof bindCardGlowTracker === "function") bindCardGlowTracker();
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

        function type() {
            if (nodeIndex >= textNodes.length) {
                // Fin: no reiniciar para evitar loop infinito de setTimeout
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

        // Cache de referencia a las tarjetas para evitar querySelectorAll en cada frame
        let cachedCards = container.querySelectorAll('.sticky-stack-card, .stage-card');
        let ticking = false;

        const updateStacking = () => {
            if (cachedCards.length === 0) return;

            if (window.innerWidth < 768) {
                cachedCards.forEach(card => {
                    card.style.top = '';
                    const innerCard = card.querySelector('.stage-card-inner') || card;
                    innerCard.style.transform = '';
                    innerCard.style.filter = '';
                });
                ticking = false;
                return;
            }

            const totalCards = cachedCards.length;
            const isMobile = window.innerWidth < 768;
            const stepOffset = isMobile ? 24 : 35;
            const startTop = isMobile ? 80 : 160;

            for (let index = 0; index < totalCards; index++) {
                const card = cachedCards[index];
                const baseTop = startTop + (index * stepOffset);
                card.style.top = `${baseTop}px`;

                const overlapThreshold = 220;
                let stackedAbove = 0;

                for (let k = index + 1; k < totalCards; k++) {
                    const nextCard = cachedCards[k];
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
                const isLightTheme = document.body.classList.contains('light-theme');

                if (currentTop <= baseTop + 20) {
                    const targetScale = Math.max(0.78, 1 - (stackedAbove * 0.035));
                    innerCard.style.transform = `perspective(1200px) scale(${targetScale})`;
                    if (!isLightTheme) {
                        const brightness = Math.max(0.45, 1 - (stackedAbove * 0.1));
                        innerCard.style.filter = `brightness(${Math.round(brightness * 100)}%)`;
                    } else {
                        innerCard.style.filter = 'none';
                    }
                } else {
                    innerCard.style.transform = 'perspective(1200px) scale(1)';
                    innerCard.style.filter = 'none';
                }
            }
            ticking = false;
        };

        const onScrollThrottled = () => {
            if (!ticking) {
                ticking = true;
                requestAnimationFrame(updateStacking);
            }
        };

        window.addEventListener('scroll', onScrollThrottled, { passive: true });
        window.addEventListener('resize', onScrollThrottled, { passive: true });
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
        let progressTicking = false;
        window.addEventListener('scroll', () => {
            if (!progressBar || progressTicking) return;
            progressTicking = true;
            requestAnimationFrame(() => {
                const totalScroll = document.documentElement.scrollHeight - window.innerHeight;
                if (totalScroll > 0) {
                    const progress = (window.scrollY / totalScroll) * 100;
                    progressBar.style.width = `${progress}%`;
                }
                progressTicking = false;
            });
        }, { passive: true });

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
     * Inicializa Lenis Smooth Scroll con soporte de inercia.
     *
     * BUG CORREGIDO: Lenis se cargaba desde cdn.jsdelivr.net por <script>, pero
     * la CSP de produccion declara script-src 'self'. El navegador bloqueaba el
     * archivo y, como el codigo preguntaba `typeof Lenis !== 'undefined'`, el
     * fallo era SILENCIOSO: en Vercel nunca hubo scroll suave y nadie se
     * enteraba. Ahora Lenis viene del bundle (npm), asi que la CSP sigue
     * estricta y el scroll funciona de verdad.
     *
     * Ademas se respeta prefers-reduced-motion: forzar inercia a quien pidio
     * menos movimiento provoca mareo y es un incumplimiento de WCAG 2.3.3.
     */
    let lenisInstance = null;

    function initSmoothScroll() {
        // Se marca SIEMPRE, incluso si Lenis no llega a arrancar: el atributo
        // es inofensivo sin Lenis y evita olvidarse si algun dia se reactiva.
        marcarContenedoresScrolleables();

        const prefiereMenosMovimiento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

        // El scroll nativo del navegador ya funciona bien en tactil y consume
        // menos bateria; Lenis solo aporta en desktop con rueda o trackpad.
        if (prefiereMenosMovimiento || esMovil()) {
            enlazarAnclasNativas();
            return;
        }

        try {
            lenisInstance = new Lenis({
                duration: 1.2,
                easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
                orientation: "vertical",
                gestureOrientation: "vertical",
                smoothWheel: true,
                wheelMultiplier: 1.0,
                touchMultiplier: 2,
                infinite: false,
            });

            function raf(time) {
                lenisInstance.raf(time);
                requestAnimationFrame(raf);
            }
            requestAnimationFrame(raf);

            document.querySelectorAll('a[href^="#"]').forEach(anchor => {
                anchor.addEventListener("click", function (e) {
                    const targetId = this.getAttribute("href");
                    // href="#" solo no apunta a nada: dejarlo pasar evita
                    // romper botones que usan el ancla como marcador.
                    if (!targetId || targetId === "#") return;
                    const target = document.querySelector(targetId);
                    if (!target) return;
                    e.preventDefault();
                    lenisInstance.scrollTo(target, { offset: -20 });
                });
            });
        } catch (err) {
            console.error("Lenis no pudo inicializarse, se usa el scroll nativo:", err?.message || err);
            enlazarAnclasNativas();
        }
    }

    /** Saltos de ancla sin Lenis, con el mismo margen superior. */
    function enlazarAnclasNativas() {
        document.querySelectorAll('a[href^="#"]').forEach(anchor => {
            anchor.addEventListener("click", function (e) {
                const targetId = this.getAttribute("href");
                if (!targetId || targetId === "#") return;
                const target = document.querySelector(targetId);
                if (!target) return;
                e.preventDefault();
                const y = target.getBoundingClientRect().top + window.scrollY - 20;
                window.scrollTo({ top: y, behavior: "smooth" });
            });
        });
    }

    /**
     * Lenis secuestra la rueda del mouse de TODA la pagina, y eso rompe el
     * scroll de cualquier contenedor interno que tenga su propio overflow.
     *
     * BUG REAL QUE ESTO CORRIGE: con el panel admin abierto (cuando todavia
     * era un modal), la rueda no hacia nada adentro de la tarjeta. Y llamar a
     * `lenis.stop()` NO alcanzaba: stop() bloquea el scroll en todos lados,
     * incluido el contenedor de adentro. La solucion correcta es marcar esos
     * contenedores con data-lenis-prevent, que le dice a Lenis "no toques los
     * eventos que ocurran acá adentro".
     *
     * Se aplica a todo lo que scrollea por su cuenta:
     *   - el cajon del menu movil
     *   - la fila horizontal de proyectos
     *   - los dialogos de SweetAlert2 (que aparecen despues, ver el observer)
     */
    function marcarContenedoresScrolleables() {
        const fijos = [
            document.getElementById("mobile-drawer"),
            document.getElementById("projects-stack-container"),
        ];
        fijos.forEach((el) => el && el.setAttribute("data-lenis-prevent", ""));

        // SweetAlert2 inyecta su contenedor recien al abrirse, asi que no
        // alcanza con marcarlo una vez al inicio: hay que esperarlo.
        const observer = new MutationObserver(() => {
            document.querySelectorAll(".swal2-container:not([data-lenis-prevent])")
                .forEach((el) => el.setAttribute("data-lenis-prevent", ""));
        });
        observer.observe(document.body, { childList: true });
    }

    /**
     * Pausa/reanuda el scroll suave. Se usa cuando algo cubre la pagina entera
     * y no queremos que el fondo siga moviendose detras.
     */
    function pausarScrollSuave() {
        if (lenisInstance) lenisInstance.stop();
    }

    function reanudarScrollSuave() {
        if (lenisInstance) lenisInstance.start();
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
