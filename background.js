// SEO Lens — service worker.
// The toolbar icon has no popup; clicking it injects the scraper + floating
// panel into the active tab. Clicking again toggles the panel closed.
chrome.action.onClicked.addListener(async (tab) => {
  try {
    if (!tab || tab.id == null) return;
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['scraper.js', 'panel.js']
    });
  } catch (err) {
    // Scripting is blocked on browser-internal pages (chrome://, web store, …).
    // Nudge the badge so the click doesn't feel dead.
    try {
      const tabId = tab && tab.id;
      await chrome.action.setBadgeText({ text: '!', tabId: tabId });
      await chrome.action.setBadgeBackgroundColor({ color: '#dc2626', tabId: tabId });
      setTimeout(() => {
        chrome.action.setBadgeText({ text: '', tabId: tabId }).catch(() => {});
      }, 2000);
    } catch (_) { /* ignore */ }
  }
});
