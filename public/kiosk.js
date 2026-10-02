/* Food Truck Kiosk — vanilla JS, no framework, old-iPad friendly.
   Pricing rule: the cart bar always shows the SUBTOTAL; taxes (if configured
   in admin) are computed server-side at order time. No client-side tax maths. */
(() => {
  'use strict';

  const $ = (sel, el = document) => el.querySelector(sel);
  const app = $('#app');

  const state = {
    menu: null,
    biz: { name: 'FOOD TRUCK', tagline: '', currencySymbol: '₹', autoResetSeconds: 20 },
    cart: new Map(), // productId -> {product, qty, mods: Map(modId -> mod)}
    activeCat: 0,
    paying: false,
    resetTimer: null,
  };

  const fmt = (paise) => `${state.biz.currencySymbol}${(paise / 100).toFixed(2).replace(/\.00$/, '')}`;

  // ---------- data ----------
  async function loadMenu() {
    try {
      const r = await fetch('/api/menu');
      if (!r.ok) throw new Error('bad status');
      const data = await r.json();
      state.menu = data;
      state.biz = { ...state.biz, ...data.business };
      return true;
    } catch {
      return false;
    }
  }

  // ---------- rendering ----------
  function render() {
    if (!state.menu) {
      app.innerHTML = `
        <div class="pay-wrap">
          <div class="pay-box">
            <div class="glyph">📡</div>
            <div class="t1">CONNECTING…</div>
            <div class="t2">Cannot reach the menu right now. Check the connection, it will retry automatically.</div>
            <button class="btn-primary" id="retry">RETRY NOW</button>
          </div>
        </div>`;
      $('#retry').addEventListener('click', boot);
      return;
    }

    const cats = state.menu.categories;
    const catBtns = cats.map((c) => `
      <button class="cat-btn" data-cat="${c.id}">
        <span class="em">${c.emoji || '🍽'}</span><span>${esc(c.name)}</span>
      </button>`).join('');

    const sections = cats.map((c) => `
      <section class="cat-section" id="cat-${c.id}" data-catid="${c.id}">
        <h2 class="cat-title"><span class="em">${c.emoji || '🍽'}</span> ${esc(c.name)}</h2>
        <div class="grid">
          ${c.items.map(cardHtml).join('')}
        </div>
      </section>`).join('');

    app.innerHTML = `
      <header class="header">
        <div>
          <div class="brand-name">${esc(state.biz.name)}</div>
          <div class="brand-tag">${esc(state.biz.tagline || '')}</div>
        </div>
        <div class="conn" id="conn"><span class="dot"></span>ONLINE</div>
      </header>
      <div class="layout">
        <nav class="cats" id="cats">${catBtns}</nav>
        <div class="menu-wrap">
          <div id="menu-scroll">${sections}</div>
        </div>
      </div>
      <div class="cartbar">
        <div class="info">
          <span class="count" id="cart-count">0 ITEMS</span>
          <span class="total" id="cart-total">${fmt(0)}</span>
        </div>
        <button class="btn-secondary" id="btn-view-cart" disabled>VIEW CART</button>
        <button class="btn-primary" id="btn-pay-now" disabled>PAY NOW →</button>
      </div>`;

    $('#cats').addEventListener('click', (e) => {
      const btn = e.target.closest('.cat-btn');
      if (!btn) return;
      const el = $(`#cat-${btn.dataset.cat}`);
      if (el) $('#menu-scroll').scrollTo({ top: el.offsetTop - 8, behavior: 'smooth' });
    });

    // scroll spy — rAF-throttled, passive listener (old-iPad friendly)
    const scroller = $('#menu-scroll');
    const sectionsArr = [...app.querySelectorAll('.cat-section')];
    let ticking = false;
    scroller.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        const top = scroller.scrollTop;
        let current = sectionsArr[0]?.dataset.catid | 0;
        for (const s of sectionsArr) {
          if (s.offsetTop - 80 <= top) current = s.dataset.catid | 0;
          else break;
        }
        setActiveCat(current);
      });
    }, { passive: true });

    $('#menu-scroll').addEventListener('click', onMenuClick);
    $('#btn-view-cart').addEventListener('click', showCart);
    $('#btn-pay-now').addEventListener('click', () => startPayment());
    $('#conn').addEventListener('click', boot);
    updateCartBar();
    restoreCart();
  }

  function cardHtml(p) {
    const qty = state.cart.has(p.id) ? state.cart.get(p.id).qty : 0;
    const img = p.image
      ? `<img loading="lazy" src="${esc(p.image)}" alt="">`
      : `<span>${p.emoji || '🍽'}</span>`;
    return `
      <article class="food-card" data-pid="${p.id}">
        <div class="food-img">${img}</div>
        <div class="food-body">
          <div class="food-name">${esc(p.name)}</div>
          <div class="food-desc">${esc(p.description || '')}</div>
          <div class="food-foot">
            <span class="price">${fmt(p.pricePaise)}</span>
            <span class="card-ctl">
              ${qty > 0
                ? `<span class="qty-row">
                     <button class="btn-q" data-act="dec" data-pid="${p.id}">−</button>
                     <span class="qty-num">${qty}</span>
                     <button class="btn-q" data-act="inc" data-pid="${p.id}">+</button>
                   </span>`
                : `<button class="btn-add" data-act="add" data-pid="${p.id}">ADD +</button>`}
            </span>
          </div>
        </div>
      </article>`;
  }

  function setActiveCat(id) {
    if (state.activeCat === id) return;
    state.activeCat = id;
    for (const b of app.querySelectorAll('.cat-btn')) {
      b.classList.toggle('active', (b.dataset.cat | 0) === id);
    }
  }

  // ---------- cart ----------
  function onMenuClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const pid = btn.dataset.pid | 0;
    const act = btn.dataset.act;
    if (act === 'add') {
      const p = findProduct(pid);
      if (!p) return;
      addToCart(p, []);
    } else if (act === 'inc' || act === 'dec') {
      const entry = state.cart.get(pid);
      if (!entry) return;
      entry.qty += act === 'inc' ? 1 : -1;
      if (entry.qty <= 0) state.cart.delete(pid);
      refreshCard(pid);
      updateCartBar();
    }
  }

  function findProduct(pid) {
    for (const c of state.menu.categories) {
      const p = c.items.find((x) => x.id === pid);
      if (p) return p;
    }
    return null;
  }

  function addToCart(product, modIds) {
    // one line per product: merging keeps the cart tidy & prevents dup adds
    const mods = new Map();
    for (const id of modIds) {
      for (const g of product.modifierGroups || []) {
        const m = g.options.find((o) => o.id === id);
        if (m) mods.set(m.id, m);
      }
    }
    const existing = state.cart.get(product.id);
    if (existing) {
      existing.qty += 1;
      for (const [k, v] of mods) existing.mods.set(k, v);
    } else {
      state.cart.set(product.id, { product, qty: 1, mods });
    }
    refreshCard(product.id);
    updateCartBar();
  }

  function lineTotal(entry) {
    let unit = entry.product.pricePaise;
    for (const m of entry.mods.values()) unit += m.pricePaise;
    return unit * entry.qty;
  }

  function cartTotal() {
    let t = 0;
    for (const e of state.cart.values()) t += lineTotal(e);
    return t;
  }

  function cartCount() {
    let n = 0;
    for (const e of state.cart.values()) n += e.qty;
    return n;
  }

  function updateCartBar() {
    const n = cartCount();
    const c = $('#cart-count'), t = $('#cart-total');
    if (c) c.textContent = `${n} ITEM${n === 1 ? '' : 'S'}`;
    if (t) t.textContent = fmt(cartTotal());
    const dis = n === 0;
    const v = $('#btn-view-cart'), p = $('#btn-pay-now');
    if (v) v.disabled = dis;
    if (p) p.disabled = dis;
    try { localStorage.setItem('kiosk_cart', JSON.stringify(n ? serializeCart() : [])); } catch {}
  }

  function serializeCart() {
    return [...state.cart.values()].map((e) => ({
      productId: e.product.id,
      qty: e.qty,
      modifierIds: [...e.mods.keys()],
    }));
  }

  function restoreCart() {
    try {
      const raw = localStorage.getItem('kiosk_cart');
      if (!raw) return;
      const arr = JSON.parse(raw);
      for (const line of arr) {
        const p = findProduct(line.productId);
        if (!p) continue;
        const mods = new Map();
        for (const id of line.modifierIds || []) {
          for (const g of p.modifierGroups || []) {
            const m = g.options.find((o) => o.id === id);
            if (m) mods.set(m.id, m);
          }
        }
        state.cart.set(p.id, { product: p, qty: line.qty, mods });
      }
      for (const pid of state.cart.keys()) refreshCard(pid);
      updateCartBar();
    } catch {}
  }

  function refreshCard(pid) {
    const p = findProduct(pid);
    const cards = app.querySelectorAll(`.food-card[data-pid="${pid}"] .card-ctl`);
    if (!p || !cards.length) return;
    const entry = state.cart.get(pid);
    const qty = entry ? entry.qty : 0;
    for (const ctl of cards) {
      ctl.innerHTML = qty > 0
        ? `<span class="qty-row">
             <button class="btn-q" data-act="dec" data-pid="${pid}">−</button>
             <span class="qty-num">${qty}</span>
             <button class="btn-q" data-act="inc" data-pid="${pid}">+</button>
           </span>`
        : `<button class="btn-add" data-act="add" data-pid="${pid}">ADD +</button>`;
    }
  }

  // ---------- cart sheet ----------
  function showCart() {
    const backdrop = document.createElement('div');
    backdrop.className = 'sheet-backdrop';
    const rows = [...state.cart.values()].map((e) => {
      const mods = [...e.mods.values()].map((m) => m.name).join(', ');
      return `
        <div class="line-item">
          <div>
            <div class="nm">${esc(e.product.name)} ×${e.qty}</div>
            ${mods ? `<div class="md">+ ${esc(mods)}</div>` : ''}
          </div>
          <div class="amt">${fmt(lineTotal(e))}</div>
        </div>`;
    }).join('');
    backdrop.innerHTML = `
      <div class="sheet">
        <div class="sheet-head">
          <div class="sheet-title">YOUR ORDER</div>
          <button class="sheet-close">✕</button>
        </div>
        <div class="sheet-body">
          ${rows || '<p style="color:var(--muted)">Your cart is empty.</p>'}
          <div class="cart-total-row"><span>TOTAL</span><span class="v">${fmt(cartTotal())}</span></div>
          <div class="cart-note">Taxes (if any) are added at the payment step as per current tax settings.</div>
        </div>
        <div class="sheet-actions">
          <button class="btn-secondary" id="cart-back">BACK TO MENU</button>
          <button class="btn-primary" id="cart-pay">PROCEED TO PAYMENT</button>
        </div>
      </div>`;
    document.body.appendChild(backdrop);
    backdrop.addEventListener('click', (e) => {
      if (e.target.closest('.sheet-close') || e.target.closest('#cart-back') || e.target === backdrop) backdrop.remove();
      if (e.target.closest('#cart-pay')) { backdrop.remove(); startPayment(); }
    });
  }

  // ---------- payment (PLACEHOLDER — gateway not connected yet) ----------
  // The order is created (number + total are final), but no payment gateway is
  // wired: this screen intentionally stays a placeholder until the PhonePe
  // integration lands (see PHONEPE_INTEGRATION.md).
  async function startPayment() {
    if (state.paying || state.cart.size === 0) return;
    state.paying = true;
    const btn = $('#btn-pay-now'); if (btn) btn.disabled = true;

    const overlay = document.createElement('div');
    overlay.className = 'pay-wrap';
    overlay.innerHTML = `
      <div class="pay-total-label">ORDER TOTAL</div>
      <div class="pay-total">${fmt(cartTotal())}</div>
      <div class="pay-box" id="pay-box">
        <div class="glyph">💳</div>
        <div class="t1">PAYMENT</div>
        <div class="t2">Payment gateway is not connected yet. Your order details are shown below — please ask staff to complete this order.</div>
      </div>
      <div class="pay-actions">
        <button class="btn-secondary" id="pay-back">← BACK</button>
        <button class="btn-secondary" id="pay-cancel">CANCEL ORDER</button>
      </div>`;
    document.body.appendChild(overlay);

    try {
      const r = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cart: serializeCart() }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message || 'Could not place the order.');
      const box = $('#pay-box');
      box.insertAdjacentHTML('beforeend',
        `<div class="t2" style="margin-top:12px;">Order <b>#${data.orderNumber}</b> · ${fmt(data.totalPaise)} · unpaid</div>`);
    } catch (err) {
      const box = $('#pay-box');
      if (box) box.innerHTML = `
        <div class="glyph">⚠️</div>
        <div class="t1">SOMETHING WENT WRONG</div>
        <div class="t2">${esc(err.message || 'Your order has NOT been charged. Please try again.')}</div>`;
    }

    overlay.addEventListener('click', (e) => {
      if (e.target.closest('#pay-back')) { overlay.remove(); state.paying = false; }
      if (e.target.closest('#pay-cancel')) { overlay.remove(); clearCart(); state.paying = false; }
    });
  }

  // ---------- success + reset ----------
  // Called by the gateway integration once payment is VERIFIED server-side.
  function showSuccess(orderNumber, totalPaise) {
    clearCart();
    const wrap = document.createElement('div');
    wrap.className = 'ok-wrap';
    wrap.innerHTML = `
      <div class="ok-check">✓</div>
      <div class="ok-title">PAYMENT SUCCESSFUL</div>
      <div class="ok-order">ORDER #${orderNumber}</div>
      <div class="ok-sub">${fmt(totalPaise)} PAID · Printing your bill…</div>
      <div class="ok-count">Starting new order in <b id="ok-sec">${state.biz.autoResetSeconds}</b>s</div>
      <button class="btn-start" id="ok-start">START NEW ORDER</button>`;
    document.body.appendChild(wrap);
    $('#ok-start').addEventListener('click', () => { wrap.remove(); });
    let left = state.biz.autoResetSeconds;
    state.resetTimer = setInterval(() => {
      left -= 1;
      const el = $('#ok-sec');
      if (el) el.textContent = left;
      if (left <= 0) { clearInterval(state.resetTimer); wrap.remove(); }
    }, 1000);
  }

  function clearCart() {
    state.cart.clear();
    try { localStorage.removeItem('kiosk_cart'); } catch {}
    for (const pid of [...app.querySelectorAll('.food-card')].map((c) => c.dataset.pid | 0)) refreshCard(pid);
    updateCartBar();
  }

  // ---------- helpers ----------
  function toast(msg, info = false) {
    const t = document.createElement('div');
    t.className = 'toast' + (info ? ' info' : '');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function watchConnection() {
    const el = $('#conn');
    const upd = () => {
      if (!el) return;
      const on = navigator.onLine;
      el.classList.toggle('off', !on);
      el.innerHTML = `<span class="dot"></span>${on ? 'ONLINE' : 'CONNECTION PROBLEM'}`;
    };
    window.addEventListener('online', upd);
    window.addEventListener('offline', upd);
    upd();
  }

  // ---------- boot ----------
  async function boot() {
    const ok = await loadMenu();
    render();
    watchConnection();
    if (!ok) setTimeout(boot, 2500);
  }

  boot();
})();
