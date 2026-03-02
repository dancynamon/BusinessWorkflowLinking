import {
  getSettings,
  migrateStorage,
  getData,
  saveData,
} from '../storage.js';

document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  await loadStats();
  bindActions();
});

async function loadSettings() {
  const settings = await getSettings();
  const radio = document.querySelector(`input[name="storageType"][value="${settings.storageType}"]`);
  if (radio) radio.checked = true;
}

async function loadStats() {
  const data = await getData();
  const groups = Object.values(data.groups);
  const totalPages = groups.reduce((sum, g) => sum + g.pages.length, 0);

  document.getElementById('stat-groups').textContent = groups.length;
  document.getElementById('stat-pages').textContent = totalPages;

  // Estimate storage size
  const jsonSize = new Blob([JSON.stringify(data)]).size;
  const kbSize = (jsonSize / 1024).toFixed(1);
  document.getElementById('stat-size').textContent = `${kbSize} KB`;
}

function bindActions() {
  // Storage type change warning
  document.querySelectorAll('input[name="storageType"]').forEach((radio) => {
    radio.addEventListener('change', async () => {
      const settings = await getSettings();
      const warning = document.getElementById('migrate-warning');
      warning.style.display = radio.value !== settings.storageType ? 'block' : 'none';
    });
  });

  // Save storage setting
  document.getElementById('btn-save-storage').addEventListener('click', async () => {
    const selected = document.querySelector('input[name="storageType"]:checked').value;
    const settings = await getSettings();

    if (selected !== settings.storageType) {
      await migrateStorage(selected);
    }

    document.getElementById('migrate-warning').style.display = 'none';
    const status = document.getElementById('save-status');
    status.textContent = 'Saved!';
    setTimeout(() => { status.textContent = ''; }, 2000);
    await loadStats();
  });

  // Export
  document.getElementById('btn-export').addEventListener('click', async () => {
    const data = await getData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `page-linker-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // Import
  document.getElementById('btn-import').addEventListener('click', () => {
    document.getElementById('import-file').click();
  });

  document.getElementById('import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      // Basic validation
      if (!data.groups || typeof data.groups !== 'object') {
        alert('Invalid file format. Expected Page Linker export file.');
        return;
      }

      if (!confirm(`Import ${Object.keys(data.groups).length} group(s)? This will replace your current data.`)) {
        return;
      }

      await saveData(data);
      await loadStats();
      alert('Data imported successfully!');
    } catch (err) {
      alert('Failed to import data: ' + err.message);
    }

    // Reset file input
    e.target.value = '';
  });

  // Clear all
  document.getElementById('btn-clear').addEventListener('click', async () => {
    if (!confirm('Delete ALL link groups? This cannot be undone.')) return;
    await saveData({ groups: {} });
    await loadStats();
  });
}
