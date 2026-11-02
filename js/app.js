import Lenis from "lenis";
import { getProjects, getCategories } from "./projects.js";
import { supabase, isSupabaseConfigured } from "./supabase.js";
import { configurarDialogos, confirmar, avisar } from "./ui-dialogs.js";
import { obtenerResenasPublicas } from "./reviews.js";
import { estrellas as pintarEstrellas } from "./iconos.js";
import {
    escapeHtml,
    safeUrl,
    sanitizeText,
    isValidEmail,
    LIMITS,
} from "./security.js";
import { pantallaViva, activarVistasVivas } from "./vista-viva.js";
import { montarPanelDemo } from "./panel-demo.js";

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

    // Formulario de contacto
    const contactForm = document.getElementById("contact-form");
    const contactName = document.getElementById("contact-name");

    let scrollRevealObserver;
    let bindCursorHoverEvents;
    let bindCardGlowTracker;

    // Variables de Estado
    let cachedCategories = [];

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

    /**
     * Cuántos proyectos se muestran en el landing.
     *
     * El resto vive en /proyectos. La razón es el efecto de tarjetas
     * apiladas: cada tarjeta se fija y se apila con el scroll, así que la
     * sección mide ALTO × cantidad. Con 5 el efecto luce; con 20 el visitante
     * tiene que scrollear varios metros para pasar de largo y llegar al
     * cotizador, que es donde se convierte.
     *
     * Cargar proyectos nuevos ya no alarga el landing.
     */
    const PROYECTOS_EN_PORTADA = 5;

    /**
     * Tarjeta fantasma del landing.
     *
     * Misma estructura que la real (.stage-card > .stage-card-inner con
     * .stack-card-info y .stage-img-box): el alto no se estima, lo calcula el
     * mismo CSS. Por eso cuando llegan los proyectos la sección no se mueve.
     *
     * Lleva el mismo `top` escalonado que las reales para que el apilado
     * sticky se vea igual desde el primer cuadro.
     */
    function tarjetaFantasmaLanding(i) {
        return `
            <div class="stage-card" data-esqueleto aria-hidden="true" style="z-index:${i + 1}; top: calc(160px + ${i * 35}px);">
                <div class="stage-card-inner">
                    <div class="stack-card-info">
                        <span class="stack-card-tag hueso">&nbsp;</span>
                        <h3 class="stack-card-title"><span class="hueso hueso-titulo">&nbsp;</span></h3>
                        <p class="stack-card-desc hueso-parrafo">
                            <span class="hueso hueso-linea"></span>
                            <span class="hueso hueso-linea"></span>
                            <span class="hueso hueso-linea"></span>
                        </p>
                        <div style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:24px;">
                            <span class="hueso hueso-pildora"></span>
                            <span class="hueso hueso-pildora"></span>
                            <span class="hueso hueso-pildora"></span>
                        </div>
                        <span class="stack-card-link"><span class="hueso hueso-chico">&nbsp;</span></span>
                    </div>
                    <div class="stage-img-box">
                        <div class="marco-nav">
                            <div class="marco-nav-barra">
                                <span class="marco-nav-punto"></span>
                                <span class="marco-nav-punto"></span>
                                <span class="marco-nav-punto"></span>
                                <span class="marco-nav-url hueso">&nbsp;</span>
                            </div>
                            <div class="marco-nav-pantalla"><div class="hueso stage-img"></div></div>
                        </div>
                    </div>
                </div>
            </div>`;
    }

    async function renderPortfolio(filter = "all") {
        const container = document.getElementById("projects-stack-container");
        if (!container) return;

        /* Fantasmas en vez del cartel «Cargando proyectos…».
           El cartel medía ~120px y la pila real mide varios miles: la página
           pegaba un salto enorme al llegar los datos, justo en la sección que
           el visitante estaba mirando. Las fantasmas reservan el alto. */
        if (!container.querySelector(".stage-card:not([data-esqueleto])")) {
            container.setAttribute("aria-busy", "true");
            container.innerHTML = Array.from({ length: 3 }, (_, i) =>
                tarjetaFantasmaLanding(i)).join("");
        }

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

            // Solo los primeros. El orden es el que arrastrás en el panel
            // (getProjects ya devuelve ordenado por `position`), así que
            // "los primeros cinco" son los cinco que vos pusiste arriba.
            const visibles = filteredProjects.slice(0, PROYECTOS_EN_PORTADA);
            const hayMas = filteredProjects.length - visibles.length;

            visibles.forEach((proj, i) => {
                const card = document.createElement("div");
                // Todo dato de proyecto proviene de la base y debe tratarse como
                // no confiable: se escapa en contexto HTML y se validan los esquemas de URL.
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
                card.className = "stage-card";
                card.style.zIndex = i + 1;
                card.style.top = `calc(160px + ${i * 35}px)`;
                card.innerHTML = `
                    <div class="stage-card-inner reveal-on-scroll" data-number="0${i + 1}">
                        <div class="stack-card-info">
                            <span class="stack-card-tag">${escapeHtml(getCategoryLabel(proj.category))}</span>
                            <h3 class="stack-card-title">${safeTitle}</h3>
                            <p class="stack-card-desc">${escapeHtml(proj.description)}</p>
                            <div style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 24px;">${tagsHTML}</div>
                            ${demoLinkHTML}
                        </div>
                        <div class="stage-img-box">
                            <!-- Marco de navegador: ver .marco-nav en styles.css. -->
                            <div class="marco-nav">
                                <div class="marco-nav-barra" aria-hidden="true">
                                    <span class="marco-nav-punto"></span>
                                    <span class="marco-nav-punto"></span>
                                    <span class="marco-nav-punto"></span>
                                    <span class="marco-nav-url">${escapeHtml(dominioDeUrl(proj.demoUrl))}</span>
                                </div>
                                <div class="marco-nav-pantalla">
                                    ${pantallaViva(safeDemoUrl, safeTitle, proj.id)}
                                </div>
                            </div>
                        </div>
                    </div>
                `;

                container.appendChild(card);

                const innerCard = card.querySelector('.stage-card-inner');
                if (innerCard && scrollRevealObserver) {
                    scrollRevealObserver.observe(innerCard);
                }
            });

            /* Las tarjetas recién se crearon: hay que engancharlas al
               observador que carga y descarga las vistas vivas. */
            activarVistasVivas(container);

            container.style.opacity = "1";
            container.setAttribute("aria-busy", "false");

            // Generar dots de navegación para vista móvil (slider horizontal)
            let dotsContainer = document.getElementById("projects-mobile-dots");
            if (!dotsContainer && container.parentNode) {
                dotsContainer = document.createElement("div");
                dotsContainer.id = "projects-mobile-dots";
                dotsContainer.className = "projects-mobile-dots";
                container.parentNode.appendChild(dotsContainer);
            }

            if (dotsContainer) {
                if (visibles.length > 1) {
                    dotsContainer.style.display = "";
                    dotsContainer.innerHTML = visibles.map((_, idx) => `
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

            // «Ver todos los proyectos».
            //
            // Vive FUERA de #projects-stack-container a propósito: ese
            // contenedor se vacía entero en cada pintado y las tarjetas de
            // adentro son `position: sticky` con z-index calculado. Un botón
            // ahí adentro se borraría en el próximo render y, mientras tanto,
            // quedaría tapado por la pila.
            //
            // Se crea una sola vez y después solo se muestra o se esconde: si
            // se recreara en cada pintado, el visitante que está justo sobre
            // el botón lo vería desaparecer y volver bajo el cursor.
            let verTodos = document.getElementById("ver-todos-proyectos");
            if (!verTodos && container.parentNode) {
                verTodos = document.createElement("div");
                verTodos.id = "ver-todos-proyectos";
                verTodos.className = "ver-todos-caja";
                container.parentNode.appendChild(verTodos);
            }
            if (verTodos) {
                if (hayMas > 0) {
                    verTodos.hidden = false;
                    verTodos.innerHTML = `
                        <a href="/proyectos" class="btn btn-outline btn-lg ver-todos-btn">
                            Ver todos los proyectos
                            <span class="ver-todos-cuenta">${hayMas} más</span>
                            <svg viewBox="0 0 24 24" aria-hidden="true" class="ver-todos-flecha"
                                 fill="none" stroke="currentColor" stroke-width="2"
                                 stroke-linecap="round" stroke-linejoin="round">
                                <path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>
                            </svg>
                        </a>`;
                } else {
                    // Con 5 o menos no hay nada más que ver: un botón que
                    // lleva a la misma lista es una promesa incumplida.
                    verTodos.hidden = true;
                    verTodos.innerHTML = "";
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

            // Las tarjetas RECIÉN existen ahora. initStackingProjectsScroll()
            // corrió al arrancar la página, cuando el contenedor todavía estaba
            // vacío, así que su lista de tarjetas quedó en cero y el efecto de
            // apilado no se aplicaba nunca. Hay que volver a leerla acá.
            recachearApilado();
    }

    /**
     * El dominio que se muestra en la barra del marco de navegador.
     * Sin "https://" ni "www.", como se lee en una barra de verdad. Si la URL
     * no sirve devuelve vacío: mejor una barra sin texto que una que diga "#".
     */
    function dominioDeUrl(url) {
        try {
            const u = new URL(String(url));
            if (!/^https?:$/.test(u.protocol)) return "";
            return u.hostname.replace(/^www\./, "");
        } catch {
            return "";
        }
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
        const cinta = document.getElementById("resenas-cinta");
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
                    <div class="resena-card-item" role="listitem">
                        <div class="resena-card-inner glass">
                            <div class="resena-top-box">
                                <div class="resena-stars" aria-label="${r.rating || 5} de 5 estrellas">
                                    ${pintarEstrellas(r.rating || 5)}
                                </div>
                                <p class="resena-comment">
                                    "${escapeHtml(commentText)}"
                                </p>
                                ${esLargo ? `
                                    <button type="button" class="resena-ver-mas-btn" aria-expanded="false">
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
                                        Ver página <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-left: 2px;"><line x1="7" y1="17" x2="17" y2="7"></line><polyline points="7 7 17 7 17 17"></polyline></svg>
                                    </a>
                                ` : ''}
                            </div>
                        </div>
                    </div>
                `;
            }).join("");

            /* «Ver más»: con un solo oyente arriba, no uno por botón. Abajo
               la cinta va a clonar las tarjetas, y un oyente por botón se
               perdería en las copias — esto las cubre a todas, incluidas las
               que todavía no existen. */
            cont.addEventListener("click", (e) => {
                const btn = e.target.closest(".resena-ver-mas-btn");
                if (!btn || !cont.contains(btn)) return;
                e.stopPropagation();

                const card = btn.closest(".resena-card-inner");
                if (!card) return;
                const abrir = !card.classList.contains("expandido");

                // Se cierra todo lo demás para que las tarjetas midan igual.
                cont.querySelectorAll(".resena-card-inner.expandido")
                    .forEach((c) => c.classList.remove("expandido"));
                cont.querySelectorAll(".resena-ver-mas-btn").forEach((b) => {
                    b.textContent = "Ver más";
                    b.setAttribute("aria-expanded", "false");
                });

                if (abrir) {
                    card.classList.add("expandido");
                    btn.textContent = "Ver menos";
                    btn.setAttribute("aria-expanded", "true");
                }
                // Mientras hay algo abierto la cinta no se mueve: si no, el
                // texto que estás leyendo se va de la pantalla solo.
                cinta?.classList.toggle("pausada", abrir);
            });

            armarCinta(cont);
        } catch (err) {
            console.error("Error cargando reseñas públicas:", err);
        }
    }

    /**
     * Convierte la lista de reseñas en una cinta que da vueltas sin cortes.
     *
     * COMO NO SE VE EL SALTO.
     * Se repite la lista hasta que el carril mide, como mínimo, el doble del
     * ancho visible. Después se desplaza exactamente el ancho de la lista
     * original (tarjetas + los gaps de adentro + el gap que la separa de la
     * copia). Al llegar al final, la copia quedó pixel por pixel donde
     * arrancó la original, la animación reinicia en cero y nadie lo nota.
     *
     * POR QUE LA DURACION SE CALCULA Y NO SE ESCRIBE.
     * Una duración fija hace que la cinta ande más rápido cuanto más
     * reseñas tengas: el mismo tiempo para recorrer más distancia. Acá se
     * fija la VELOCIDAD y se despeja el tiempo, así se lee igual de cómodo
     * con 3 reseñas que con 30.
     */
    function armarCinta(cont) {
        const cinta = document.getElementById("resenas-cinta");
        if (!cinta) return;

        const PIXELES_POR_SEGUNDO = 42;   // ritmo de lectura tranquilo

        /* Las copias de la medición anterior se van PRIMERO. Si se sacaran
           después de leer los hijos, al remedir (rotar el celular) las
           copias contarían como originales y la cinta se duplicaría sola en
           cada vuelta hasta quedarse sin memoria. */
        cont.querySelectorAll("[data-copia]").forEach((e) => e.remove());

        const originales = [...cont.children];
        if (!originales.length) return;

        /* Con «menos movimiento» no hay cinta ni copias: queda la lista tal
           cual, que se recorre con el dedo o la rueda. Clonar ahí solo
           lograría que el lector de pantalla lea todo dos veces. */
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
            cont.style.removeProperty("--cinta-dur");
            cont.style.removeProperty("--cinta-paso");
            return;
        }

        const gap = parseFloat(getComputedStyle(cont).columnGap) || 0;
        const paso = originales.reduce((t, el) => t + el.getBoundingClientRect().width + gap, 0);
        if (paso <= 0) return;

        /* Hacen falta copias hasta cubrir el ancho visible MÁS una vuelta
           entera; si no, al volver a cero queda un hueco a la derecha. */
        const faltan = Math.max(1, Math.ceil(cinta.clientWidth / paso));
        for (let i = 0; i < faltan; i++) {
            for (const el of originales) {
                const copia = el.cloneNode(true);
                copia.dataset.copia = "1";
                copia.setAttribute("aria-hidden", "true");
                copia.removeAttribute("role");
                // Fuera del orden de tabulación: es la misma reseña otra vez.
                copia.querySelectorAll("a, button").forEach((n) => (n.tabIndex = -1));
                cont.appendChild(copia);
            }
        }

        cont.style.setProperty("--cinta-paso", `${paso}px`);
        cont.style.setProperty("--cinta-dur", `${(paso / PIXELES_POR_SEGUNDO).toFixed(1)}s`);

        /* Lo de abajo se engancha UNA sola vez. armarCinta() se vuelve a
           llamar cada vez que cambia el ancho, y sin esta guarda cada
           llamada dejaría otro ResizeObserver mirando el mismo elemento:
           cada cambio de tamaño dispararía el doble de mediciones que el
           anterior, y así para siempre. */
        if (cinta.dataset.enganchada) return;
        cinta.dataset.enganchada = "1";

        /* En el celular no hay hover: el :hover del CSS se queda pegado
           después de tocar. Con pointerdown/up la cinta frena mientras el
           dedo está apoyado y sigue al soltarlo. */
        cinta.addEventListener("pointerdown", () => cinta.classList.add("tocando"));
        for (const ev of ["pointerup", "pointercancel", "pointerleave"]) {
            cinta.addEventListener(ev, () => cinta.classList.remove("tocando"));
        }

        /* Si cambia el ancho (rotar el celular, agrandar la ventana) el paso
           ya no sirve: se vuelve a medir con las tarjetas originales. */
        let remedir;
        new ResizeObserver(() => {
            clearTimeout(remedir);
            remedir = setTimeout(() => armarCinta(cont), 250);
        }).observe(cinta);
    }

    // ==========================================================================
    // Preloader con Logo Tipeándose (Optimizado para carga ultra rápida en móvil/iOS)
    // ==========================================================================
    function initPreloader() {
        const loader = document.getElementById("page-loader");
        const typewriterEl = document.getElementById("loader-typewriter");
        if (!loader || !typewriterEl) return { finish: () => {} };

        const fullText = "Ariel.Dev";

        /**
         * DOS SEGUNDOS EN TOTAL, contados desde que el visitante pidió la
         * página — no desde que arrancó este JavaScript.
         *
         * La diferencia no es un detalle. Date.now() mide desde que corre
         * esta función, que es ~600 ms después de la navegación; con
         * performance.now() los 2000 son 2000 de verdad.
         */
        const DURACION_TOTAL = 2000;

        // Quien pidió menos movimiento ve el nombre completo, sin tipeo.
        const sinMovimiento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

        if (sinMovimiento) {
            typewriterEl.textContent = fullText;
        } else {
            /* 105 ms por carácter. El cálculo: el tipeo arranca a los ~550 ms
               (lo que tarda en bajar y ejecutarse este módulo), 9 caracteres
               × 105 ms son ~950 ms, así que el nombre queda completo cerca de
               los 1,5 s y se lee entero medio segundo antes de que la
               pantalla se vaya. */
            let charIdx = 0;
            const typeInterval = setInterval(() => {
                if (charIdx <= fullText.length) {
                    typewriterEl.textContent = fullText.slice(0, charIdx);
                    charIdx++;
                } else {
                    clearInterval(typeInterval);
                }
            }, 105);
        }

        let programado = false;

        /**
         * Cierra a los 2 s desde el inicio de la navegación — nunca antes.
         *
         * El piso vive ACÁ y no en quien llama, porque hay dos caminos que
         * cierran el loader (init() al terminar, y el temporizador de
         * seguridad) y los dos tienen que respetarlo.
         */
        const cerrar = () => {
            if (programado) return;
            programado = true;
            setTimeout(() => loader.classList.add("hidden-loader"),
                       Math.max(0, DURACION_TOTAL - performance.now()));
        };

        /* RED DE SEGURIDAD: se cierra solo, pase lo que pase.
           Medido: con Supabase sin responder, la versión anterior dejaba la
           pantalla de carga PARA SIEMPRE. No alcanzaba con tener el
           finish() en un `finally`, porque una petición que queda colgada no
           resuelve ni falla: el `finally` nunca llega a ejecutarse.
           Una pantalla de carga no puede depender de que la red conteste. */
        cerrar();

        return { finish: cerrar };
    }

    // ==========================================================================
    // 8. Inicialización al cargar la página
    // ==========================================================================
    async function init() {
        const preloader = initPreloader();

        // Primero de todo: dejar SweetAlert2 en la capa correcta. Si algo falla
        // más abajo, al menos el cartel de error se va a ver.
        configurarDialogos();

        initSmoothScroll();
        initScrollEffects();
        initMagnetEffect();
        initCodeTypingEffect();
        montarPanelDemo(document.getElementById("panel-demo"));
        init3DTilt();
        initStackingProjectsScroll();
        renderizarResenasPublicas();

        /* La pantalla de carga YA NO ESPERA a que lleguen los proyectos.
           Esperarlos era el error de fondo: la sección de portfolio tiene su
           propio cartel de «Cargando proyectos…», así que tapar la página
           entera mientras tanto no le ahorraba nada al visitante — le
           escondía el hero, el cotizador y el contacto, que ya estaban
           listos. Medido con Supabase a 1500 ms: el logo tapaba la página
           hasta los 3542 ms, con la página pintada desde los 732 ms.
           Ahora la página aparece a los 2 s y el portfolio se completa a la
           vista. */
        preloader.finish();

        // Carga de categorías y proyectos del portfolio
        try {
            cachedCategories = await getCategories();
            await renderFilters();
            await renderPortfolio();
        } catch (e) {
            console.error("No se pudo cargar el portfolio:", e?.message || e);
        }

        // Redirección de "Beneficios de Tener"
        const btnVerVentajas = document.getElementById("btn-ver-ventajas");
        const selectServicio = document.getElementById("select-servicio");
        if (btnVerVentajas && selectServicio) {
            const SERVICIOS_VALIDOS = ["landing", "ecommerce", "portfolio", "desarrollo-medida", "invitaciones"];

            const sincronizarDestino = () => {
                const service = selectServicio.value;
                if (SERVICIOS_VALIDOS.includes(service)) {
                    const url = `ventajas-${service}.html`;
                    btnVerVentajas.setAttribute("href", url);
                    btnVerVentajas.href = url;
                }
            };

            sincronizarDestino();
            selectServicio.addEventListener("change", sincronizarDestino);

            btnVerVentajas.addEventListener("click", (e) => {
                const service = selectServicio.value;
                if (SERVICIOS_VALIDOS.includes(service)) {
                    const targetUrl = `ventajas-${service}.html`;
                    btnVerVentajas.href = targetUrl;
                    window.location.href = targetUrl;
                }
            });
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
     * Vuelve a leer las tarjetas del apilado y repinta.
     *
     * Arranca como función vacía y la reemplaza initStackingProjectsScroll().
     * Existe porque renderPortfolio() pinta las tarjetas DESPUÉS de que el
     * efecto se inicializó, y sin esto la lista de tarjetas quedaba vacía para
     * siempre.
     */
    let recachearApilado = () => {};

    /**
     * Apilamiento 3D interactivo en la sección de proyectos al hacer scroll.
     *
     * DOS BUGS QUE TENÍA
     * ------------------
     * 1. Las tarjetas se leían UNA sola vez, al arrancar la página. Pero los
     *    proyectos vienen de Supabase y se pintan después, así que la lista
     *    quedaba en cero y el efecto no se aplicaba nunca. Comprobado en el
     *    navegador: ninguna tarjeta recibía transform. Se arregla con
     *    recachearApilado(), que llama renderPortfolio() al terminar de pintar.
     *
     * 2. Dentro del mismo bucle se ESCRIBÍA card.style.top y enseguida se LEÍA
     *    getBoundingClientRect() de las tarjetas siguientes. Cada lectura
     *    después de una escritura obliga al navegador a recalcular el layout a
     *    mitad del bucle, y encima en la primera pasada las tarjetas de más
     *    abajo todavía no tenían su top puesto: se medían mal y el apilado
     *    salía con la escala equivocada justo en los primeros scrolls. Ahora
     *    va en tres pasadas: escribir todo, leer todo, aplicar todo.
     */
    function initStackingProjectsScroll() {
        const container = document.getElementById('projects-stack-container');
        if (!container) return;

        // Cache de referencia a las tarjetas para evitar querySelectorAll en cada frame
        let cachedCards = container.querySelectorAll('.sticky-stack-card, .stage-card');
        let ticking = false;

        const updateCardTops = () => {
            if (cachedCards.length === 0) return;
            const isMobile = window.innerWidth < 768;
            const stepOffset = isMobile ? 24 : 35;
            const startTop = isMobile ? 80 : 160;

            for (let i = 0; i < cachedCards.length; i++) {
                if (isMobile) {
                    cachedCards[i].style.top = '';
                    const innerCard = cachedCards[i].querySelector('.stage-card-inner') || cachedCards[i];
                    innerCard.style.transform = '';
                    innerCard.style.filter = '';
                } else {
                    cachedCards[i].style.top = `${startTop + (i * stepOffset)}px`;
                }
            }
        };

        recachearApilado = () => {
            cachedCards = container.querySelectorAll('.sticky-stack-card, .stage-card');
            updateCardTops();
            updateStacking();
        };

        const updateStacking = () => {
            if (cachedCards.length === 0) return;

            if (window.innerWidth < 768) {
                cachedCards.forEach(card => {
                    const innerCard = card.querySelector('.stage-card-inner') || card;
                    innerCard.style.transform = '';
                    innerCard.style.filter = '';
                });
                ticking = false;
                return;
            }

            const totalCards = cachedCards.length;
            const stepOffset = 35;
            const startTop = 160;
            const overlapThreshold = 220;
            const isLightTheme = document.body.classList.contains('light-theme');

            const topsReales = new Array(totalCards);
            const baseTops = new Array(totalCards);

            for (let i = 0; i < totalCards; i++) {
                baseTops[i] = startTop + (i * stepOffset);
                topsReales[i] = cachedCards[i].getBoundingClientRect().top;
            }

            for (let index = 0; index < totalCards; index++) {
                const card = cachedCards[index];
                const baseTop = baseTops[index];

                let stackedAbove = 0;
                for (let k = index + 1; k < totalCards; k++) {
                    const diff = topsReales[k] - baseTops[k];
                    if (diff < overlapThreshold) {
                        stackedAbove += Math.max(0, Math.min(1, 1 - (diff / overlapThreshold)));
                    }
                }

                const innerCard = card.querySelector('.stage-card-inner') || card;
                const currentTop = topsReales[index];

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
        window.addEventListener('resize', () => {
            updateCardTops();
            onScrollThrottled();
        }, { passive: true });

        updateCardTops();
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
            const interactives = document.querySelectorAll('a, button, input, select, textarea, .interactive, [role="button"], .filter-btn');
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
        
        /**
         * Suelta la capa de GPU de un elemento cuando termina de aparecer.
         *
         * `.reveal-on-scroll` declara `will-change: opacity, transform`, que
         * le pide al navegador una capa dedicada. La clase nunca se saca, así
         * que esas capas quedaban reservadas PARA SIEMPRE: medido, 19
         * elementos las sostenían con la página quieta. will-change es una
         * pista para una animación que está por pasar, no un ajuste
         * permanente; sostenerla gasta memoria de video sin dar nada a cambio
         * y en un celular de gama media se nota.
         *
         * Se libera en `transitionend` y no al agregar la clase: si se
         * quitara en ese momento, se estaría sacando la capa justo cuando
         * empieza la animación, que es cuando sirve.
         *
         * El temporizador es por si `transitionend` no llega nunca — pasa
         * cuando el elemento está oculto, cuando la persona pidió menos
         * movimiento, o si alguien cambia la duración de la transición. Sin
         * él, esos elementos se quedarían con la capa igual que antes.
         */
        const liberarCapa = (el) => {
            let hecho = false;
            const soltar = () => {
                if (hecho) return;
                hecho = true;
                el.style.willChange = 'auto';
            };
            el.addEventListener('transitionend', soltar, { once: true });
            setTimeout(soltar, 1200);   // la transición dura 0,8 s
        };

        scrollRevealObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('revealed');
                    liberarCapa(entry.target);
                    
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
