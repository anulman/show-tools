chrome.action.onClicked.addListener(async tab => {
  if (!tab.id || !tab.url?.startsWith('https://docs.google.com/spreadsheets/d/')) return;
  await chrome.tabs.create({ url: chrome.runtime.getURL(`follow.html?tabId=${tab.id}`) });
});
