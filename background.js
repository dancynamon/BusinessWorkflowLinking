import {
  getAllGroups,
  getGroupsForUrl,
  createGroup,
  addPageToGroup,
} from './storage.js';

// --- Badge management ---

async function updateBadge(tabId, url) {
  if (!url || url.startsWith('chrome://') || url.startsWith('chrome-extension://')) {
    await chrome.action.setBadgeText({ text: '', tabId });
    return;
  }

  const groups = await getGroupsForUrl(url);
  const count = groups.length;
  await chrome.action.setBadgeText({
    text: count > 0 ? String(count) : '',
    tabId,
  });
  await chrome.action.setBadgeBackgroundColor({
    color: count > 0 ? '#4285f4' : '#666666',
    tabId,
  });
}

// Update badge when tab URL changes
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === 'complete') {
    updateBadge(tabId, tab.url);
  }
});

// Update badge when switching tabs
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tab = await chrome.tabs.get(activeInfo.tabId);
  updateBadge(activeInfo.tabId, tab.url);
});

// --- Context menu ---

chrome.runtime.onInstalled.addListener(() => {
  // Parent menu
  chrome.contextMenus.create({
    id: 'pageLinkerParent',
    title: 'Page Linker',
    contexts: ['page'],
  });

  // "New Group with this page" option
  chrome.contextMenus.create({
    id: 'pageLinkerNewGroup',
    parentId: 'pageLinkerParent',
    title: 'New group with this page...',
    contexts: ['page'],
  });

  // Separator
  chrome.contextMenus.create({
    id: 'pageLinkerSeparator',
    parentId: 'pageLinkerParent',
    type: 'separator',
    contexts: ['page'],
  });

  rebuildContextMenu();
});

async function rebuildContextMenu() {
  // Remove old dynamic entries
  const groups = await getAllGroups();

  // Remove all existing group items (they have ids starting with 'pageLinkerGroup_')
  for (const group of groups) {
    try {
      await chrome.contextMenus.remove(`pageLinkerGroup_${group.id}`);
    } catch {
      // Item didn't exist, that's fine
    }
  }

  // Re-add current groups
  for (const group of groups) {
    chrome.contextMenus.create({
      id: `pageLinkerGroup_${group.id}`,
      parentId: 'pageLinkerParent',
      title: `Add to "${group.name}"`,
      contexts: ['page'],
    });
  }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const page = {
    url: tab.url,
    title: tab.title,
    favicon: tab.favIconUrl || '',
  };

  if (info.menuItemId === 'pageLinkerNewGroup') {
    // Create a group with a default name, user can rename in popup
    const group = await createGroup(`Group ${Date.now()}`, '#4285f4', page);
    await rebuildContextMenu();
    updateBadge(tab.id, tab.url);

    // Notify popup if open
    chrome.runtime.sendMessage({
      type: 'groupCreated',
      group,
      openRename: true,
    }).catch(() => {});
  } else if (info.menuItemId.startsWith('pageLinkerGroup_')) {
    const groupId = info.menuItemId.replace('pageLinkerGroup_', '');
    await addPageToGroup(groupId, page);
    updateBadge(tab.id, tab.url);

    chrome.runtime.sendMessage({ type: 'pageAdded', groupId }).catch(() => {});
  }
});

// --- Message handling from popup ---

const HEX_TO_CHROME_COLOR = {
  '#4285f4': 'blue',
  '#ea4335': 'red',
  '#fbbc04': 'yellow',
  '#34a853': 'green',
  '#ff6d01': 'orange',
  '#46bdc6': 'cyan',
  '#7b61ff': 'purple',
  '#e91e63': 'pink',
  '#795548': 'grey',
  '#607d8b': 'grey',
};

function chromeColor(hex) {
  return HEX_TO_CHROME_COLOR[hex] || 'grey';
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'rebuildContextMenu') {
    rebuildContextMenu().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message.type === 'updateBadge') {
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (tab) updateBadge(tab.id, tab.url);
      sendResponse({ ok: true });
    });
    return true;
  }
  if (message.type === 'openInTabGroup') {
    (async () => {
      const { url, groupName, groupColor, sourceTabId, windowId } = message;
      const newTab = await chrome.tabs.create({ url });

      // Reuse an existing Chrome tab group with the same name in this window
      const existing = await chrome.tabGroups.query({ title: groupName, windowId });

      if (existing.length > 0) {
        await chrome.tabs.group({ tabIds: [sourceTabId, newTab.id], groupId: existing[0].id });
      } else {
        const chromeGroupId = await chrome.tabs.group({ tabIds: [sourceTabId, newTab.id] });
        await chrome.tabGroups.update(chromeGroupId, {
          title: groupName,
          color: chromeColor(groupColor),
        });
      }
      sendResponse({ ok: true });
    })();
    return true;
  }
});

// Rebuild context menu on storage changes (handles cross-tab updates)
chrome.storage.onChanged.addListener(() => {
  rebuildContextMenu();
});
