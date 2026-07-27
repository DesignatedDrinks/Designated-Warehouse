'use strict';

(() => {
  const ENDPOINT_KEY = 'designated_warehouse_loc_endpoint_v1';
  const byId = id => document.getElementById(id);

  function endpointFromStorage() {
    try { return String(localStorage.getItem(ENDPOINT_KEY) || '').trim(); }
    catch { return ''; }
  }

  function saveEndpoint(value) {
    try { localStorage.setItem(ENDPOINT_KEY, String(value || '').trim()); }
    catch {}
  }

  function canonicalLocCode(value) {
    const raw = String(value || '').trim().toUpperCase();
    if (!raw) return '';
    const match = raw.match(/^([ABCD])[-\s]?(\d{1,2})(?:\.(5))?$/);
    if (!match) throw new Error('Use a location such as A-01, B-06.5 or C-12.');
    const number = Number(match[2]);
    if (number < 1 || number > 12) throw new Error('Location numbers must be from 1 to 12.');
    return `${match[1]}-${String(number).padStart(2, '0')}${match[3] ? '.5' : ''}`;
  }

  function activeItem() {
    return typeof currentItem === 'function' ? currentItem() : null;
  }

  function activeLookup(item) {
    if (!item || typeof state === 'undefined' || !(state.lookup instanceof Map)) return null;
    return state.lookup.get(item.key) || null;
  }

  function showMaintenanceMessage(text, type = '') {
    const message = byId('maintenanceMessage');
    if (!message) return;
    message.textContent = text || '';
    message.className = `maintenanceMessage${type ? ` ${type}` : ''}`;
  }

  function openMaintenance() {
    const item = activeItem();
    if (!item) {
      if (typeof showError === 'function') showError('There is no active product to edit.');
      return;
    }

    const lookup = activeLookup(item);
    const endpoint = endpointFromStorage();
    byId('maintenanceProductTitle').textContent = item.itemTitle || 'Current product';
    byId('maintenanceProductId').textContent = lookup?.productId || 'No Shopify product ID — title matching will be used';
    byId('locCodeInput').value = lookup?.locCode || item.locCode || '';
    byId('maintenancePin').value = '';
    byId('locCodeEndpoint').value = endpoint;
    byId('endpointDetails').open = !endpoint;
    showMaintenanceMessage('');
    byId('maintenanceOverlay').hidden = false;
    document.body.style.overflow = 'hidden';
    setTimeout(() => byId('locCodeInput').focus(), 0);
  }

  function closeMaintenance() {
    byId('maintenanceOverlay').hidden = true;
    document.body.style.overflow = '';
    byId('maintenancePin').value = '';
  }

  function applyLocationLocally(itemKey, locCode) {
    if (typeof state === 'undefined') return;
    const location = typeof parseLocation === 'function'
      ? parseLocation(locCode)
      : { label: locCode || 'NO LOC', sort: [9999, 999, 999] };

    const lookup = state.lookup instanceof Map ? state.lookup.get(itemKey) : null;
    if (lookup) lookup.locCode = locCode;

    state.orders.forEach(order => {
      order.items.forEach(item => {
        if (item.key !== itemKey) return;
        item.locCode = locCode;
        item.locLabel = location.label;
        item.locSort = location.sort;
      });
      if (typeof compareSort === 'function') {
        order.items.sort((a, b) => compareSort(a.locSort, b.locSort) || a.itemTitle.localeCompare(b.itemTitle));
      }
    });

    state.itemIndex = 0;
    if (typeof render === 'function') render();
  }

  async function saveLocCode(event) {
    event.preventDefault();
    const item = activeItem();
    if (!item) return;

    const lookup = activeLookup(item);
    const endpoint = String(byId('locCodeEndpoint').value || '').trim();
    const pin = String(byId('maintenancePin').value || '').trim();
    const saveButton = byId('btnSaveLocCode');

    try {
      const locCode = canonicalLocCode(byId('locCodeInput').value);
      if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec(?:\?.*)?$/i.test(endpoint)) {
        throw new Error('Add the deployed Apps Script web app URL ending in /exec.');
      }
      if (!pin) throw new Error('Enter the maintenance PIN.');

      saveEndpoint(endpoint);
      saveButton.disabled = true;
      saveButton.textContent = 'Saving…';
      showMaintenanceMessage('');

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'updateLocCode',
          pin,
          locCode,
          productId: lookup?.productId || '',
          itemTitle: item.itemTitle || ''
        }),
        redirect: 'follow',
        cache: 'no-store'
      });

      const text = await response.text();
      let result;
      try { result = JSON.parse(text); }
      catch { throw new Error('The maintenance endpoint returned an invalid response.'); }
      if (!result.ok) throw new Error(result.error || 'The location could not be saved.');

      applyLocationLocally(item.key, result.locCode ?? locCode);
      showMaintenanceMessage(`Saved ${result.locCode || 'blank location'}.`, 'success');
      setTimeout(closeMaintenance, 500);
    } catch (error) {
      showMaintenanceMessage(error.message || 'The location could not be saved.', 'error');
      byId('endpointDetails').open = !endpointFromStorage();
    } finally {
      saveButton.disabled = false;
      saveButton.textContent = 'Save location';
    }
  }

  function wireMaintenance() {
    const button = byId('btnMaintenance');
    if (!button) return;

    button.addEventListener('click', openMaintenance);
    byId('btnCloseMaintenance').addEventListener('click', closeMaintenance);
    byId('maintenanceOverlay').addEventListener('pointerdown', event => {
      if (event.target === byId('maintenanceOverlay')) closeMaintenance();
    });
    byId('locCodeForm').addEventListener('submit', saveLocCode);

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !byId('maintenanceOverlay').hidden) closeMaintenance();
    });
  }

  wireMaintenance();
})();