'use strict';
/** Shared UI builders — loaded before app.js */
window.NoroUI = (function () {
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) {
      if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  function skeletonBlock(className) {
    return h('div', { class: 'ui-skeleton ' + (className || ''), role: 'presentation', 'aria-hidden': 'true' });
  }

  function emptyState(title, description, actionEl) {
    return h('div', { class: 'ui-empty', role: 'status' },
      h('div', { class: 'ui-empty-mark', 'aria-hidden': 'true' }),
      h('p', { class: 'ui-empty-title' }, title),
      description ? h('p', { class: 'ui-empty-desc' }, description) : null,
      actionEl || null
    );
  }

  function errorState(title, description, onRetry) {
    const retry = onRetry
      ? h('button', { class: 'btn small secondary', type: 'button', onclick: onRetry }, 'Retry')
      : null;
    return h('div', { class: 'ui-error', role: 'alert' },
      h('p', { class: 'ui-empty-title' }, title),
      description ? h('p', { class: 'ui-empty-desc' }, description) : null,
      retry
    );
  }

  function liveBadge(status) {
    const live = status === 'live';
    const checking = status === 'pending';
    const offline = status === 'offline';
    const cls = live ? 'live' : checking || offline ? 'offline' : 'warn';
    const label = live ? 'Live now' : checking ? 'Checking' : offline ? 'Offline' : 'Unavailable';
    return h('span', { class: 'ui-badge ' + cls },
      live ? h('span', { class: 'ui-badge-dot', 'aria-hidden': 'true' }) : null,
      label
    );
  }

  function initialsAvatar(name) {
    const text = String(name || '?').trim();
    const parts = text.replace(/\*+/g, '').split(/\s+/).filter(Boolean);
    let initials = parts.length >= 2 ? (parts[0][0] + parts[1][0]) : text.slice(0, 2);
    initials = initials.toUpperCase() || '?';
    return h('span', { class: 'avatar', 'aria-hidden': 'true' }, initials);
  }

  function mountTabs(tablist) {
    if (tablist.querySelector('.ui-tab-indicator')) return tablist._refreshTabs;
    const indicator = h('span', { class: 'ui-tab-indicator', 'aria-hidden': 'true' });
    tablist.prepend(indicator);
    const refresh = () => {
      const active = tablist.querySelector('[aria-selected="true"]');
      if (!active) return;
      indicator.style.width = active.offsetWidth + 'px';
      indicator.style.transform = 'translateX(' + active.offsetLeft + 'px)';
    };
    tablist._refreshTabs = refresh;
    tablist.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft' && event.key !== 'Home' && event.key !== 'End') return;
      const tabs = [...tablist.querySelectorAll('[role="tab"]')];
      const index = tabs.indexOf(document.activeElement);
      if (index < 0) return;
      event.preventDefault();
      let next = index;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
      else if (event.key === 'Home') next = 0;
      else next = tabs.length - 1;
      tabs[next].focus();
      tabs[next].click();
    });
    return refresh;
  }

  return { h, skeletonBlock, emptyState, errorState, liveBadge, initialsAvatar, mountTabs };
})();
