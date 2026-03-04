// Storage abstraction layer for Page Linker
// Supports both chrome.storage.local and chrome.storage.sync

const STORAGE_KEY = 'pageLinkerData';
const SETTINGS_KEY = 'pageLinkerSettings';
const LAST_GROUP_KEY = 'pageLinkerLastGroupId';

function generateId() {
  return crypto.randomUUID();
}

function getDefaultData() {
  return { groups: {} };
}

function getDefaultSettings() {
  return { storageType: 'local' };
}

async function getSettings() {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  return result[SETTINGS_KEY] || getDefaultSettings();
}

async function saveSettings(settings) {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

function getStorageArea(storageType) {
  return storageType === 'sync' ? chrome.storage.sync : chrome.storage.local;
}

async function getData() {
  const settings = await getSettings();
  const area = getStorageArea(settings.storageType);
  const result = await area.get(STORAGE_KEY);
  return result[STORAGE_KEY] || getDefaultData();
}

async function saveData(data) {
  const settings = await getSettings();
  const area = getStorageArea(settings.storageType);
  await area.set({ [STORAGE_KEY]: data });
}

// Migrate data between local and sync storage
async function migrateStorage(newStorageType) {
  const settings = await getSettings();
  const oldArea = getStorageArea(settings.storageType);
  const newArea = getStorageArea(newStorageType);

  // Read from old
  const oldResult = await oldArea.get(STORAGE_KEY);
  const data = oldResult[STORAGE_KEY] || getDefaultData();

  // Write to new
  await newArea.set({ [STORAGE_KEY]: data });

  // Update settings
  await saveSettings({ ...settings, storageType: newStorageType });

  // Clean old (only if different)
  if (settings.storageType !== newStorageType) {
    await oldArea.remove(STORAGE_KEY);
  }
}

// --- Group operations ---

async function createGroup(name, color, initialPage) {
  const data = await getData();
  const id = generateId();
  const group = {
    id,
    name,
    color,
    createdAt: Date.now(),
    pages: [],
  };
  if (initialPage) {
    group.pages.push({
      url: initialPage.url,
      title: initialPage.title,
      favicon: initialPage.favicon || '',
      addedAt: Date.now(),
    });
  }
  data.groups[id] = group;
  await saveData(data);
  return group;
}

async function deleteGroup(groupId) {
  const data = await getData();
  delete data.groups[groupId];
  await saveData(data);
}

async function renameGroup(groupId, newName) {
  const data = await getData();
  if (data.groups[groupId]) {
    data.groups[groupId].name = newName;
    await saveData(data);
  }
}

async function recolorGroup(groupId, newColor) {
  const data = await getData();
  if (data.groups[groupId]) {
    data.groups[groupId].color = newColor;
    await saveData(data);
  }
}

async function addPageToGroup(groupId, page) {
  const data = await getData();
  const group = data.groups[groupId];
  if (!group) return null;

  // Don't add duplicate URLs
  if (group.pages.some((p) => p.url === page.url)) {
    return group;
  }

  group.pages.push({
    url: page.url,
    title: page.title,
    favicon: page.favicon || '',
    addedAt: Date.now(),
  });
  await saveData(data);
  return group;
}

async function removePageFromGroup(groupId, url) {
  const data = await getData();
  const group = data.groups[groupId];
  if (!group) return;

  group.pages = group.pages.filter((p) => p.url !== url);

  // Delete the group if it's now empty
  if (group.pages.length === 0) {
    delete data.groups[groupId];
  }

  await saveData(data);
}

async function getAllGroups() {
  const data = await getData();
  return Object.values(data.groups);
}

async function getGroupsForUrl(url) {
  const data = await getData();
  return Object.values(data.groups).filter((group) =>
    group.pages.some((p) => p.url === url)
  );
}

async function getGroupById(groupId) {
  const data = await getData();
  return data.groups[groupId] || null;
}

async function getLastGroupId() {
  const result = await chrome.storage.local.get(LAST_GROUP_KEY);
  return result[LAST_GROUP_KEY] || null;
}

async function setLastGroupId(groupId) {
  await chrome.storage.local.set({ [LAST_GROUP_KEY]: groupId });
}

// Export for use as ES module in service worker and popup
export {
  generateId,
  getSettings,
  saveSettings,
  migrateStorage,
  getData,
  saveData,
  createGroup,
  deleteGroup,
  renameGroup,
  recolorGroup,
  addPageToGroup,
  removePageFromGroup,
  getAllGroups,
  getGroupsForUrl,
  getGroupById,
  getLastGroupId,
  setLastGroupId,
};
