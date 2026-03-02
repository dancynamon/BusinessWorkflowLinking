import {
  createGroup,
  deleteGroup,
  renameGroup,
  recolorGroup,
  addPageToGroup,
  removePageFromGroup,
  getAllGroups,
  getGroupsForUrl,
} from '../storage.js';

// Preset colors for groups
const COLORS = [
  '#4285f4', '#ea4335', '#fbbc04', '#34a853', '#ff6d01',
  '#46bdc6', '#7b61ff', '#e91e63', '#795548', '#607d8b',
];

let currentTab = null;
let expandedGroups = new Set();
let searchQuery = '';

// --- Init ---

document.addEventListener('DOMContentLoaded', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;

  renderCurrentPage();
  await renderGroups();
  bindActions();
});

// Listen for background messages
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'groupCreated' || message.type === 'pageAdded') {
    renderGroups();
  }
});

// --- Render current page info ---

function renderCurrentPage() {
  const titleEl = document.getElementById('current-title');
  const domainEl = document.getElementById('current-domain');
  const faviconEl = document.getElementById('current-favicon');

  titleEl.textContent = currentTab.title || 'Untitled';
  domainEl.textContent = getDomain(currentTab.url);

  if (currentTab.favIconUrl) {
    faviconEl.src = currentTab.favIconUrl;
  } else {
    faviconEl.style.display = 'none';
  }
}

// --- Render groups ---

async function renderGroups() {
  const container = document.getElementById('groups-container');
  const emptyState = document.getElementById('empty-state');

  const groups = await getGroupsForUrl(currentTab.url);
  const searchBar = document.getElementById('search-bar');

  if (groups.length === 0) {
    container.innerHTML = '';
    searchBar.style.display = 'none';
    emptyState.style.display = 'block';
    return;
  }

  emptyState.style.display = 'none';
  searchBar.style.display = 'flex';

  const query = searchQuery.toLowerCase();
  const filtered = query
    ? groups.filter((group) =>
        group.name.toLowerCase().includes(query) ||
        group.pages.some((p) => (p.title || '').toLowerCase().includes(query))
      )
    : groups;

  if (filtered.length === 0) {
    container.innerHTML = '<div class="no-results">No matching groups</div>';
    return;
  }

  container.innerHTML = filtered.map((group) => renderGroupCard(group)).join('');

  // Bind group interactions
  container.querySelectorAll('.group-header').forEach((header) => {
    header.addEventListener('click', (e) => {
      // Don't toggle if clicking the rename input
      if (e.target.classList.contains('group-name-input')) return;
      const groupId = header.dataset.groupId;
      toggleGroup(groupId);
    });
  });

  // Bind linked page clicks
  container.querySelectorAll('.linked-page[data-url]').forEach((el) => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.linked-page-remove')) return;
      const url = el.dataset.url;
      if (url !== currentTab.url) {
        const card = el.closest('.group-card');
        // Send to background script which persists after popup closes
        chrome.runtime.sendMessage({
          type: 'openInTabGroup',
          url,
          groupName: card.dataset.groupName,
          groupColor: card.dataset.groupColor,
          sourceTabId: currentTab.id,
          windowId: currentTab.windowId,
        });
        window.close();
      }
    });
  });

  // Bind remove buttons
  container.querySelectorAll('.linked-page-remove').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const groupId = btn.dataset.groupId;
      const url = btn.dataset.url;
      await removePageFromGroup(groupId, url);
      notifyBackground();
      await renderGroups();
    });
  });

  // Bind group action buttons
  container.querySelectorAll('.btn-rename').forEach((btn) => {
    btn.addEventListener('click', () => startRename(btn.dataset.groupId));
  });

  container.querySelectorAll('.btn-recolor').forEach((btn) => {
    btn.addEventListener('click', () => showRecolorModal(btn.dataset.groupId));
  });

  container.querySelectorAll('.btn-delete-group').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const groupId = btn.dataset.groupId;
      await deleteGroup(groupId);
      notifyBackground();
      await renderGroups();
    });
  });
}

function renderGroupCard(group) {
  const isExpanded = expandedGroups.has(group.id);
  const otherPages = group.pages.filter((p) => p.url !== currentTab.url);
  const currentInGroup = group.pages.find((p) => p.url === currentTab.url);

  return `
    <div class="group-card" data-group-id="${group.id}" data-group-name="${escapeAttr(group.name)}" data-group-color="${escapeAttr(group.color)}">
      <div class="group-header" data-group-id="${group.id}">
        <span class="group-color-dot" style="background: ${group.color}"></span>
        <span class="group-name">${escapeHtml(group.name)}</span>
        <span class="group-count">${group.pages.length} page${group.pages.length !== 1 ? 's' : ''}</span>
        <svg class="group-chevron ${isExpanded ? 'open' : ''}" viewBox="0 0 24 24" width="14" height="14">
          <path d="M9 18l6-6-6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </div>
      <div class="group-body ${isExpanded ? 'open' : ''}">
        ${currentInGroup ? renderLinkedPage(currentInGroup, group.id, true) : ''}
        ${otherPages.map((p) => renderLinkedPage(p, group.id, false)).join('')}
        <div class="group-actions">
          <button class="btn btn-sm btn-secondary btn-rename" data-group-id="${group.id}">Rename</button>
          <button class="btn btn-sm btn-secondary btn-recolor" data-group-id="${group.id}">Color</button>
          <button class="btn btn-sm btn-danger btn-delete-group" data-group-id="${group.id}">Delete</button>
        </div>
      </div>
    </div>
  `;
}

function renderLinkedPage(page, groupId, isCurrent) {
  const domain = getDomain(page.url);
  const faviconSrc = page.favicon
    ? page.favicon
    : `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(page.url)}&size=16`;

  return `
    <div class="linked-page ${isCurrent ? 'current' : ''}" data-url="${escapeAttr(page.url)}">
      <img class="linked-page-favicon" src="${escapeAttr(faviconSrc)}" alt="" onerror="this.style.display='none'">
      <div class="linked-page-text">
        <div class="linked-page-title">${escapeHtml(page.title || 'Untitled')}</div>
        <div class="linked-page-domain">${escapeHtml(domain)}</div>
      </div>
      ${isCurrent
        ? '<span class="linked-page-domain" style="font-style:italic">current</span>'
        : '<span class="linked-page-arrow">&rarr;</span>'
      }
      <button class="linked-page-remove" data-group-id="${groupId}" data-url="${escapeAttr(page.url)}" title="Remove from group">&times;</button>
    </div>
  `;
}

function toggleGroup(groupId) {
  if (expandedGroups.has(groupId)) {
    expandedGroups.delete(groupId);
  } else {
    expandedGroups.add(groupId);
  }
  renderGroups();
}

// --- Inline rename ---

function startRename(groupId) {
  const card = document.querySelector(`.group-card[data-group-id="${groupId}"]`);
  const nameSpan = card.querySelector('.group-name');
  const currentName = nameSpan.textContent;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'group-name-input';
  input.value = currentName;
  nameSpan.replaceWith(input);
  input.focus();
  input.select();

  async function finishRename() {
    const newName = input.value.trim() || currentName;
    await renameGroup(groupId, newName);
    notifyBackground();
    await renderGroups();
  }

  input.addEventListener('blur', finishRename);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') {
      input.value = currentName;
      input.blur();
    }
  });
}

// --- Recolor modal ---

function showRecolorModal(groupId) {
  showModal('Change Color', `
    <div class="color-picker-row">
      ${COLORS.map((c) => `
        <div class="color-swatch" data-color="${c}" style="background: ${c}"></div>
      `).join('')}
    </div>
    <div class="form-actions">
      <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
    </div>
  `);

  document.querySelectorAll('.color-swatch').forEach((swatch) => {
    swatch.addEventListener('click', async () => {
      await recolorGroup(groupId, swatch.dataset.color);
      hideModal();
      notifyBackground();
      await renderGroups();
    });
  });

  document.getElementById('modal-cancel').addEventListener('click', hideModal);
}

// --- Bind top-level actions ---

function bindActions() {
  document.getElementById('btn-new-group').addEventListener('click', showNewGroupModal);
  document.getElementById('btn-add-to-group').addEventListener('click', showAddToGroupModal);
  document.getElementById('btn-settings').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  document.getElementById('search-input').addEventListener('input', (e) => {
    searchQuery = e.target.value;
    renderGroups();
  });
}

// --- New group modal ---

function showNewGroupModal() {
  showModal('New Link Group', `
    <div class="form-group">
      <label class="form-label">Group Name</label>
      <input type="text" class="form-input" id="new-group-name" placeholder="e.g. Shopify Order #1234" autofocus>
    </div>
    <div class="form-group">
      <label class="form-label">Color</label>
      <div class="color-picker-row">
        ${COLORS.map((c, i) => `
          <div class="color-swatch ${i === 0 ? 'selected' : ''}" data-color="${c}" style="background: ${c}"></div>
        `).join('')}
      </div>
    </div>
    <div class="form-actions">
      <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
      <button class="btn btn-primary" id="modal-create">Create</button>
    </div>
  `);

  let selectedColor = COLORS[0];

  document.querySelectorAll('.color-swatch').forEach((swatch) => {
    swatch.addEventListener('click', () => {
      document.querySelectorAll('.color-swatch').forEach((s) => s.classList.remove('selected'));
      swatch.classList.add('selected');
      selectedColor = swatch.dataset.color;
    });
  });

  document.getElementById('modal-cancel').addEventListener('click', hideModal);

  document.getElementById('modal-create').addEventListener('click', async () => {
    const name = document.getElementById('new-group-name').value.trim();
    if (!name) {
      document.getElementById('new-group-name').focus();
      return;
    }

    const page = {
      url: currentTab.url,
      title: currentTab.title,
      favicon: currentTab.favIconUrl || '',
    };

    await createGroup(name, selectedColor, page);
    hideModal();
    notifyBackground();
    // Auto-expand the new group
    const groups = await getGroupsForUrl(currentTab.url);
    groups.forEach((g) => expandedGroups.add(g.id));
    await renderGroups();
  });

  // Enter to submit
  document.getElementById('new-group-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('modal-create').click();
  });
}

// --- Add to existing group modal ---

async function showAddToGroupModal() {
  const allGroups = await getAllGroups();
  const currentGroups = await getGroupsForUrl(currentTab.url);
  const currentGroupIds = new Set(currentGroups.map((g) => g.id));

  if (allGroups.length === 0) {
    showNewGroupModal();
    return;
  }

  const listHtml = allGroups.map((group) => {
    const alreadyIn = currentGroupIds.has(group.id);
    return `
      <div class="group-select-item ${alreadyIn ? 'disabled' : ''}" data-group-id="${group.id}">
        <span class="group-color-dot" style="background: ${group.color}"></span>
        <span class="group-select-name">${escapeHtml(group.name)}</span>
        <span class="group-select-count">${group.pages.length} page${group.pages.length !== 1 ? 's' : ''}${alreadyIn ? ' (already linked)' : ''}</span>
      </div>
    `;
  }).join('');

  showModal('Add to Group', `
    <div class="group-select-list">${listHtml}</div>
  `);

  document.querySelectorAll('.group-select-item:not(.disabled)').forEach((item) => {
    item.addEventListener('click', async () => {
      const groupId = item.dataset.groupId;
      const page = {
        url: currentTab.url,
        title: currentTab.title,
        favicon: currentTab.favIconUrl || '',
      };
      await addPageToGroup(groupId, page);
      hideModal();
      notifyBackground();
      expandedGroups.add(groupId);
      await renderGroups();
    });
  });
}

// --- Modal helpers ---

function showModal(title, bodyHtml) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHtml;
  document.getElementById('modal-overlay').style.display = 'flex';
  document.getElementById('modal-close').addEventListener('click', hideModal);
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('modal-overlay')) hideModal();
  });
}

function hideModal() {
  document.getElementById('modal-overlay').style.display = 'none';
}

// --- Utilities ---

function getDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function notifyBackground() {
  chrome.runtime.sendMessage({ type: 'rebuildContextMenu' }).catch(() => {});
  chrome.runtime.sendMessage({ type: 'updateBadge' }).catch(() => {});
}
