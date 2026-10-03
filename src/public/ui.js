'use strict';
/** Shared UI builders — extends app.js `h()` when loaded first */
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

  function skeletonBlock(className, style) {
    const el = h('div', { class: 'ui-skeleton ' + (className || ''), role: 'presentation', 'aria-hidden': 'true' });
    if (style) el.setAttribute('style', style);
    return el;
  }

  function emptyState(title, description, actionEl) {
    return h('div', { class: 'ui-empty', role: 'status' },
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
    const cls = live ? 'live' : checking ? 'offline' : offline ? 'offline' : 'warn';
    const label = live ? 'Live now' : checking ? 'Checking' : offline ? 'Offline' : 'Unavailable';
    return h('span', { class: 'ui-badge ' + cls },
      live ? h('span', { class: 'ui-badge-dot', 'aria-hidden': 'true' }) : null,
      label
    );
  }

  function initialsAvatar(name) {
    const text = String(name || '?').trim();
    const parts = text.replace(/\*+/g, '').split(/\s+/).filter(Boolean);
    let initials = parts.length >= 2
      ? (parts[0][0] + parts[1][0])
      : text.slice(0, 2);
    initials = initials.toUpperCase() || '?';
    return h('span', { class: 'avatar', 'aria-hidden': 'true' }, initials);
  }

  return { h, skeletonBlock, emptyState, errorState, liveBadge, initialsAvatar };
})();
