chrome.runtime.onInstalled.addListener(async () => {
  await chrome.contextMenus.create({
    title: "ELI5 Selection",
    contexts: ["selection"],
    id: "eli5-selection-summarizer"
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  console.log(info.selectionText);
});
