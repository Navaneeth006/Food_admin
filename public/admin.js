/* Admin dashboard — vanilla JS. */
(() => {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const main = $('#main');
  let menu = null;
  let settings = {};

  const api = {
    get: (u) => fetch(u).then(async (r) => { if (r.status === 401) { location.href = '/admin/login'; throw new Error('unauth'); } if (!r.ok) throw new Error('request failed'); return r.json(); }),
    post: (u, b) => fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b ?? {}) }).then(parse),
    patch: (u, b) => fetch(u, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b ?? {}) }).then(parse),
    del: (u) => fetch(u, { method: 'DELETE' }).then(parse),
  };
  function parse(r) {
    if (r.status === 401) { location.href = '/admin/login'; throw new Error('unauth'); }
    if (!r.ok) throw new Error('request failed');
    return r.json();
  }

  const fmt = (p) => '₹' + (p / 100).toFixed(2).replace(/\.00$/, '');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function toast(msg, isErr = false) {
    const t = document.createElement('div');
    t.className = 'toast' + (isErr ? ' err' : '');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2500);
  }

  const VIEWS = {};

  // ---------------- Dashboard ----------------
  VIEWS.dashboard = async () => {
    const s = await api.get('/api/admin/stats');
    main.innerHTML = `
      <h2>Today</h2>
      <div class="cards">
        <div class="stat"><div class="l">ORDERS</div><div class="v">${s.orders}</div></div>
        <div class="stat"><div class="l">PAID</div><div class="v">${s.paid}</div></div>
        <div class="stat"><div class="l">PENDING</div><div class="v">${s.pending}</div></div>
        <div class="stat"><div class="l">COMPLETED</div><div class="v">${s.completed}</div></div>
        <div class="stat"><div class="l">REVENUE</div><div class="v">${fmt(s.revenue_paise)}</div></div>
        <div class="stat"><div class="l">AVG ORDER</div><div class="v">${fmt(s.avg_order_paise)}</div></div>
      </div>
      <p class="muted">Orders are tracked here with live status updates and receipts.</p>`;
  };

  // ---------------- Orders ----------------
  VIEWS.orders = async () => {
    const [orders] = await Promise.all([api.get('/api/admin/orders?limit=100'), loadMenuOnce()]);
    main.innerHTML = `
      <h2>Orders</h2>
      <div class="toolbar">
        <input id="q" placeholder="Search order # / payment ref" style="flex:1; max-width:320px;">
        <button class="btn" id="search">Search</button>
      </div>
      <table>
        <thead><tr><th>#</th><th>Items</th><th>Total</th><th>Payment</th><th>Status</th><th>Print</th><th></th></tr></thead>
        <tbody>
          ${orders.map((o) => `
            <tr>
              <td><b>#${o.order_number}</b><div class="muted">${o.created_at}</div></td>
              <td>${o.items.map((i) => esc(i.name) + ' ×' + i.qty).join('<br>')}</td>
              <td><b>${fmt(o.total_paise)}</b></td>
              <td><span class="pill ${o.payment_status}">${o.payment_status}</span></td>
              <td><span class="pill ${o.status}">${o.status}</span></td>
              <td><span class="pill ${o.print_status}">${o.print_status}</span></td>
              <td>
                <button class="btn" data-reprint="${o.id}">Reprint</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>`;
    $('#search').addEventListener('click', async () => {
      const q = $('#q').value.trim();
      const list = await api.get('/api/admin/orders?limit=100' + (q ? `&q=${encodeURIComponent(q)}` : ''));
      main.innerHTML = main.innerHTML; // simple re-render hint
      toast(q ? `Showing results for "${q}"` : 'Showing recent orders');
      // naive re-render: replace tbody
      const tb = $('tbody');
      tb.innerHTML = list.map((o) => `
        <tr>
          <td><b>#${o.order_number}</b><div class="muted">${o.created_at}</div></td>
          <td>${o.items.map((i) => esc(i.name) + ' ×' + i.qty).join('<br>')}</td>
          <td><b>${fmt(o.total_paise)}</b></td>
          <td><span class="pill ${o.payment_status}">${o.payment_status}</span></td>
          <td><span class="pill ${o.status}">${o.status}</span></td>
          <td><span class="pill ${o.print_status}">${o.print_status}</span></td>
          <td><button class="btn" data-reprint="${o.id}">Reprint</button></td>
        </tr>`).join('');
    });
    main.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-reprint]');
      if (!b) return;
      await api.post(`/api/admin/orders/${b.dataset.reprint}/reprint`);
      toast('Reprint queued');
    }, { once: false });
  };

  // ---------------- Menu ----------------
  async function loadMenuOnce() {
    if (!menu) menu = await api.get('/api/admin/menu');
  }

  VIEWS.menu = async () => {
    await loadMenuOnce();
    renderMenu();
  };

  function renderMenu() {
    main.innerHTML = `
      <h2>Menu Manager</h2>
      <div class="toolbar">
        <button class="btn primary" id="add-cat">+ Add Category</button>
        <button class="btn" id="add-item">+ Add Item</button>
      </div>
      <div class="menu-tree">
        ${menu.categories.map((c) => `
          <div class="cat-row">
            <span>${c.emoji || '🍽'}</span>
            <span class="grow">${esc(c.name)}</span>
            <span class="muted">${c.available ? 'available' : 'hidden'}</span>
            <button class="btn" data-edit-cat="${c.id}">Edit</button>
            <button class="btn danger" data-del-cat="${c.id}">Delete</button>
          </div>
          ${c.items.map((p) => `
            <div class="item-row">
              <span>${p.emoji || '·'}</span>
              <span class="grow">${esc(p.name)} ${p.available ? '' : '<i class="muted">(unavailable)</i>'}</span>
              <span class="price">${fmt(p.pricePaise)}</span>
              <button class="btn" data-edit-item="${p.id}">Edit</button>
              <button class="btn danger" data-del-item="${p.id}">Delete</button>
            </div>`).join('')}
        `).join('')}
      </div>`;

    main.onclick = async (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.id === 'add-cat') return editCategory(null);
      if (b.id === 'add-item') return editItem(null);
      if (b.dataset.editCat) return editCategory(menu.categories.find((c) => c.id == b.dataset.editCat));
      if (b.dataset.delCat) {
        if (confirm('Delete this category and all its items?')) {
          menu = (await api.del(`/api/admin/categories/${b.dataset.delCat}`)).menu;
          renderMenu();
        }
        return;
      }
      if (b.dataset.editItem) return editItem(findItem(b.dataset.editItem));
      if (b.dataset.delItem) {
        if (confirm('Delete this item?')) {
          menu = (await api.del(`/api/admin/products/${b.dataset.delItem}`)).menu;
          renderMenu();
        }
        return;
      }
    };
  }

  function findItem(id) {
    for (const c of menu.categories) {
      const p = c.items.find((x) => x.id == id);
      if (p) return p;
    }
    return null;
  }

  function editCategory(cat) {
    const isNew = !cat;
    const name = prompt('Category name', cat?.name ?? '');
    if (name === null) return;
    const emoji = prompt('Emoji', cat?.emoji ?? '🍽') ?? '';
    if (isNew) api.post('/api/admin/categories', { name, emoji }).then((r) => { menu = r.menu; renderMenu(); toast('Category added'); });
    else api.patch(`/api/admin/categories/${cat.id}`, { name, emoji }).then((r) => { menu = r.menu; renderMenu(); toast('Category updated'); });
  }

  function editItem(item) {
    const isNew = !item;
    const html = `
      <div class="field"><label>NAME</label><input id="f-name" value="${esc(item?.name ?? '')}"></div>
      <div class="field"><label>CATEGORY</label>
        <select id="f-cat">${menu.categories.map((c) => `<option value="${c.id}" ${item && item.id && findCatOfItem(item.id) === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      </div>
      <div class="field"><label>PRICE (₹)</label><input id="f-price" type="number" min="0" step="0.01" value="${item ? (item.pricePaise / 100).toFixed(2) : ''}"></div>
      <div class="field"><label>DESCRIPTION</label><input id="f-desc" value="${esc(item?.description ?? '')}"></div>
      <div class="field"><label>EMOJI (shown if no image)</label><input id="f-emoji" value="${esc(item?.emoji ?? '')}"></div>
      <div class="field"><label>IMAGE (URL or upload)</label>
        <div class="row"><input id="f-img" value="${esc(item?.image ?? '')}" style="flex:1;">
        <button class="btn" id="f-up">Upload</button></div>
      </div>
      <div class="switch"><input type="checkbox" id="f-avail" ${!item || item.available ? 'checked' : ''}><label for="f-avail" style="color:var(--text)">Available</label></div>
      <div style="display:flex; gap:10px; justify-content:flex-end;">
        <button class="btn" id="f-cancel">Cancel</button>
        <button class="btn primary" id="f-save">Save</button>
      </div>`;
    modal(html, () => {
      const payload = {
        name: $('#f-name').value.trim(),
        category_id: +$('#f-cat').value,
        price_paise: Math.round(parseFloat($('#f-price').value || '0') * 100),
        description: $('#f-desc').value,
        emoji: $('#f-emoji').value,
        image: $('#f-img').value || null,
        available: $('#f-avail').checked,
      };
      if (!payload.name) { toast('Name required', true); return false; }
      if (isNew) return api.post('/api/admin/products', payload).then((r) => { menu = r.menu; renderMenu(); toast('Item added'); }).catch(() => toast('Save failed', true));
      return api.patch(`/api/admin/products/${item.id}`, payload).then((r) => { menu = r.menu; renderMenu(); toast('Item updated'); }).catch(() => toast('Save failed', true));
    }, () => {
      $('#f-up').addEventListener('click', () => {
        const inp = document.createElement('input');
        inp.type = 'file'; inp.accept = 'image/*';
        inp.onchange = async () => {
          const file = inp.files[0];
          if (!file) return;
          const r = await fetch('/api/admin/upload', { method: 'POST', headers: { 'content-type': file.type }, body: file });
          if (r.ok) { const d = await r.json(); $('#f-img').value = d.url; toast('Image uploaded'); }
          else toast('Upload failed', true);
        };
        inp.click();
      });
    });
  }

  function findCatOfItem(itemId) {
    for (const c of menu.categories) if (c.items.some((x) => x.id == itemId)) return c.id;
    return '';
  }

  // ---------------- Billing / Bill designer ----------------
  VIEWS.billing = async () => {
    settings = await api.get('/api/admin/settings');
    const F = (key, label, ph = '') => `
      <div class="field"><label>${label}</label>
        <input data-set="${key}" value="${esc(settings[key] ?? '')}" placeholder="${ph}"></div>`;
    const SW = (key, label) => `
      <div class="switch"><input type="checkbox" id="sw-${key}" data-sw="${key}" ${settings[key] !== '0' ? 'checked' : ''}><label for="sw-${key}" style="color:var(--text)">${label}</label></div>`;
    main.innerHTML = `
      <h2>Bill Designer</h2>
      <div class="grid2">
        <div>
          ${F('business_name', 'BUSINESS NAME')}
          ${F('business_tagline', 'TAGLINE')}
          ${F('address', 'ADDRESS')}
          ${F('phone', 'PHONE')}
          ${F('gst_number', 'GSTIN')}
          <div class="field"><label>GST % (0 disables tax)</label><input data-set="gst_percent" type="number" min="0" max="40" value="${esc(settings.gst_percent ?? '0')}"></div>
          <div class="field"><label>GST LABEL</label><input data-set="gst_label" value="${esc(settings.gst_label ?? 'GST')}"></div>
          ${SW('show_gst_on_receipt', 'Show tax line on receipt')}
          ${SW('show_phone', 'Show phone')}
          ${SW('show_address', 'Show address')}
          ${SW('show_cut_line', 'Print cut line')}
          ${F('receipt_footer', 'FOOTER')}
          ${F('thank_you_message', 'THANK-YOU MESSAGE')}
          <div class="field"><label>PAPER WIDTH (chars: 32 or 48)</label><input data-set="paper_width_chars" type="number" min="20" max="64" value="${esc(settings.paper_width_chars ?? '32')}"></div>
          <div class="field"><label>RECEIPT FONT SCALE (0.8–1.5)</label><input data-set="receipt_font_scale" step="0.05" value="${esc(settings.receipt_font_scale ?? '1')}"></div>
          <div class="field"><label>HEADER LINES (one per line)</label><textarea data-set="receipt_header_lines" rows="2"></textarea></div>
          <button class="btn primary" id="save-billing">SAVE SETTINGS</button>
        </div>
        <div>
          <div class="muted" style="margin-bottom:8px;">LIVE PREVIEW</div>
          <div class="pre" id="bill-preview">Loading preview…</div>
        </div>
      </div>`;

    // load header lines value after render
    $('[data-set="receipt_header_lines"]').value = settings.receipt_header_lines ?? '';

    const preview = async () => {
      const body = collectBilling();
      const r = await api.post('/api/admin/settings', body); // persist so preview reflects reality
      const rr = await fetch('/api/admin/receipt-preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) });
      if (rr.ok) {
        const d = await rr.json();
        $('#bill-preview').textContent = d.text;
      } else {
        // endpoint may not exist yet — render client-side approximation
        $('#bill-preview').textContent = clientPreview(body);
      }
    };
    const clientPreview = (s) => {
      const w = Math.max(20, Math.min(64, parseInt(s.paper_width_chars, 10) || 32));
      const hr = '─'.repeat(w);
      return [s.business_name, s.address, s.phone ? 'Ph: ' + s.phone : '', s.gst_number ? 'GSTIN: ' + s.gst_number : '', hr,
        'ORDER #1047', '22/09/2026 08:32 PM', hr,
        'Peri Peri Fries x2        ₹198', 'Melted Cheese x1           ₹25', hr,
        'Subtotal                  ₹223', '18% GST incl             ₹27', 'TOTAL                     ₹250', 'PAYMENT: PAID', hr,
        s.receipt_footer || ''].filter(Boolean).join('\n');
    };

    let tmr = null;
    main.addEventListener('input', () => {
      clearTimeout(tmr);
      tmr = setTimeout(preview, 500);
    });
    $('#save-billing').addEventListener('click', async () => {
      await api.post('/api/admin/settings', collectBilling());
      toast('Bill settings saved');
    });
    preview();
  };

  function collectBilling() {
    const out = {};
    for (const el of main.querySelectorAll('[data-set]')) out[el.dataset.set] = el.value;
    for (const el of main.querySelectorAll('[data-sw]')) out[el.dataset.sw] = el.checked ? '1' : '0';
    return out;
  }

  // ---------------- Printer ----------------
  VIEWS.printer = async () => {
    const st = await api.get('/api/admin/printer');
    const jobs = await api.get('/api/admin/print-jobs?limit=50');
    main.innerHTML = `
      <h2>Printer</h2>
      <div class="cards">
        <div class="stat"><div class="l">DRIVER</div><div class="v">${esc(st.driver)}</div></div>
        <div class="stat"><div class="l">STATUS</div><div class="v">${st.configured ? 'READY' : 'NOT SET'}</div></div>
      </div>
      <p class="muted">${esc(st.hint || '')}</p>
      <div class="toolbar"><button class="btn primary" id="test-print">SEND TEST PRINT</button></div>
      <h2 style="margin-top:26px;">Print Queue</h2>
      <table>
        <thead><tr><th>Job</th><th>Order</th><th>Kind</th><th>Status</th><th>Error</th><th></th></tr></thead>
        <tbody>
          ${jobs.map((j) => `
            <tr>
              <td>${j.id}</td>
              <td>#${j.order_number}</td>
              <td>${j.kind}</td>
              <td><span class="pill ${j.status}">${j.status}</span></td>
              <td class="muted">${esc(j.last_error || '')}</td>
              <td>${j.status === 'failed' ? `<button class="btn" data-retry="${j.id}">Retry</button>` : ''}</td>
            </tr>`).join('') || '<tr><td colspan="6" class="muted">No print jobs yet.</td></tr>'}
        </tbody>
      </table>`;
    $('#test-print').addEventListener('click', async () => {
      const r = await fetch('/api/admin/printer/test', { method: 'POST' }).then((x) => x.json()).catch(() => ({ ok: false }));
      toast(r.ok ? 'Test print sent' : 'Printer not reachable', !r.ok);
      VIEWS.printer();
    });
    main.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-retry]');
      if (!b) return;
      await api.post(`/api/admin/print-jobs/${b.dataset.retry}/retry`);
      toast('Retry queued');
      setTimeout(VIEWS.printer, 600);
    });
  };

  // ---------------- Settings ----------------
  VIEWS.settings = async () => {
    settings = await api.get('/api/admin/settings');
    const F = (key, label, type = 'text') => `
      <div class="field"><label>${label}</label><input data-set="${key}" type="${type}" value="${esc(settings[key] ?? '')}"></div>`;
    main.innerHTML = `
      <h2>Settings</h2>
      <div class="grid2">
        <div>
          <h3 style="font-size:15px;">Kiosk</h3>
          ${F('auto_reset_seconds', 'AUTO-RESET SECONDS', 'number')}
          ${F('max_qty_per_item', 'MAX QTY PER ITEM', 'number')}
          ${F('currency_symbol', 'CURRENCY SYMBOL')}
          <h3 style="font-size:15px; margin-top:20px;">Order numbers</h3>
          <p class="muted">Starts at 1001. The backend assigns sequential numbers — duplicates are impossible.</p>
          <button class="btn primary" id="save-settings">SAVE SETTINGS</button>
        </div>
        <div>
          <h3 style="font-size:15px;">System</h3>
          <p class="muted">Payment gateway: <b>not configured</b> — reserved for PhonePe integration (see PHONEPE_INTEGRATION.md).</p>
          <p class="muted">Printer driver is set via <b>.env</b> (PRINTER_DRIVER). Restart the server after changing.</p>
          <p class="muted">Admin PIN is set via <b>ADMIN_PIN_SHA256</b> in .env. Generate a hash with:<br><code>node server/scripts/pin-hash.js yourpin</code></p>
        </div>
      </div>`;
    $('#save-settings').addEventListener('click', async () => {
      const out = {};
      for (const el of main.querySelectorAll('[data-set]')) out[el.dataset.set] = el.value;
      await api.post('/api/admin/settings', out);
      toast('Settings saved');
    });
  };

  // ---------------- modal helper ----------------
  function modal(html, onConfirm, after) {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `<div class="modal">${html}</div>`;
    document.body.appendChild(bg);
    if (after) after();
    bg.addEventListener('click', async (e) => {
      if (e.target === bg || e.target.id.endsWith('-cancel')) { bg.remove(); return; }
      if (e.target.id.endsWith('-save') || e.target.id.endsWith('-create')) {
        const ok = await onConfirm();
        if (ok !== false) bg.remove();
      }
    });
  }

  // ---------------- nav ----------------
  $('#nav').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'logout') { fetch('/api/admin/logout', { method: 'POST' }).then(() => (location.href = '/admin/login')); return; }
    for (const x of document.querySelectorAll('nav button')) x.classList.toggle('active', x === b);
    const view = VIEWS[b.dataset.view];
    if (view) view().catch((err) => toast(err.message, true));
  });

  VIEWS.dashboard().catch(() => {});
})();
