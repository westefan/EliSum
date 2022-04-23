const submit = document.getElementById("submit");

(async function init() {
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  submit.innerHTML = isYoutubeUrl(tab.url)
    ? "Parse YouTube transcript"
    : isWikipediaUrl(tab.url)
    ? "Parse Wikipedia article"
    : "Parse from text selection";
})();

submit.addEventListener("click", async () => {
  updateLoading(true);
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});

  if (isWikipediaUrl(tab.url)) {
    chrome.scripting.executeScript(
      {
        target: {tabId: tab.id},
        function: parseWikipediaArticleContent
      },
      async (result) => {
        document.getElementById("source-output").innerHTML = result[0].result;

        updateLoading(false);
      }
    );

    return;
  }

  if (isYoutubeUrl(tab.url)) {
    chrome.scripting.executeScript(
      {
        target: {tabId: tab.id},
        function: getYoutubeTranscript
      },
      async (result) => {
        if (!result[0] || result[0].result === "PARSING_FAILED") {
          updateLoading(false);

          return;
        }

        const resultJson = result[0].result;

        const plainText = resultJson.map((v) => v.text).join(" ");
        const sourceOutput = document.getElementById("source-output");

        /*const summarizeResult = await summarize(plainText);
      document.getElementById('summary-output').innerHTML = summarizeResult.choices[0].text;*/

        for (const section of resultJson) {
          const span = document.createElement("span");
          span.innerHTML = section.text + "&nbsp;";
          span.setAttribute("data-start", Math.floor(section.start));
          sourceOutput.appendChild(span);
        }

        updateLoading(false);

        sourceOutput.addEventListener("click", (event) => {
          const start = event.target.getAttribute("data-start");
          if (!start) {
            return;
          }

          chrome.scripting.executeScript({
            target: {tabId: tab.id},
            function: changeYoutubeStartUrl,
            args: [start]
          });
        });
      }
    );

    return;
  }

  chrome.scripting.executeScript(
    {
      target: {tabId: tab.id},
      function: getSelectionText
    },
    async (result) => {
      const rawText = result[0].result;
      const summarizeResult = await summarize(rawText);

      document.getElementById("summary-output").innerHTML = summarizeResult.choices[0].text;
      document.getElementById("source-output").innerHTML = rawText;

      updateLoading(false);
    }
  );
});

async function summarize(text) {
  const response = await fetch("http://localhost:3000/summarize", {
    method: "POST",
    body: JSON.stringify({text}),
    headers: {"Content-type": "application/json; charset=UTF-8"}
  });
  return await response.json();
}

async function getYoutubeTranscript() {
  /**
   * Modified version from David Walsh XML2JSON https://davidwalsh.name/convert-xml-json
   */
  function xmlToJson(xml) {
    var obj = {};

    if (xml.nodeType == 1) {
      // do attributes
      if (xml.attributes.length > 0) {
        for (var j = 0; j < xml.attributes.length; j++) {
          var attribute = xml.attributes.item(j);
          obj[attribute.nodeName] = attribute.nodeValue;
        }
      }
    } else if (xml.nodeType == 3) {
      // text
      obj = xml.nodeValue;
    }

    // do children
    if (xml.hasChildNodes()) {
      for (var i = 0; i < xml.childNodes.length; i++) {
        var item = xml.childNodes.item(i);
        var nodeName = item.nodeName.replace(/^#/, "");
        if (typeof obj[nodeName] === "undefined") {
          obj[nodeName] = xmlToJson(item);
        } else {
          if (typeof obj[nodeName].push === "undefined") {
            var old = obj[nodeName];
            obj[nodeName] = [];
            obj[nodeName].push(old);
          }
          obj[nodeName].push(xmlToJson(item));
        }
      }
    }
    return obj;
  }

  try {
    // fetch new site as raw text to escape potential bug when navigating in YT's SPA
    const siteResponse = await fetch(window.location.href);
    const rawHtml = await siteResponse.text();
    const captions = JSON.parse(
      rawHtml.split('"captions":')[1].split(',"videoDetails')[0].replace("\n", "")
    ).playerCaptionsTracklistRenderer;
    const timedTextUrl = captions.captionTracks[0].baseUrl;
    console.log(captions);

    const response = await fetch(timedTextUrl);
    const text = await response.text();
    const xml = new window.DOMParser().parseFromString(text, "text/xml");
    const json = xmlToJson(xml);

    return json.transcript.text;
  } catch (e) {
    console.error(e);
    return "PARSING_FAILED";
  }
}

function updateLoading(isLoading) {
  const img = document.getElementById("logo");
  isLoading ? img.classList.add("loading") : img.classList.remove("loading");
}

function changeYoutubeStartUrl(start) {
  const url = new URL(window.location);
  const searchParams = new URLSearchParams(url.search);
  searchParams.set("t", start);
  url.search = searchParams.toString();
  window.location = url.toString();
}

function getSelectionText() {
  return window.getSelection().toString();
}

function isWikipediaUrl(url) {
  return url.includes("en.wikipedia.org");
}

function isYoutubeUrl(url) {
  return url.includes("youtube.com");
}

function parseWikipediaArticleContent() {
  function removeUnusedTags(rootEl) {
    const SELECTORS_TO_REMOVE = [
      "style",
      "noscript",
      "script",
      ".reflist",
      "#toc",
      "table.sidebar",
      '[style*="display:none"]',
      '[style*="display: none"]',
      ".printfooter",
      "#siteSub",
      ".mw-jump-link",
      ".hatnote",
      "#mw-normal-catlinks",
      "#mw-hidden-catlinks"
    ];
    for (const selector of SELECTORS_TO_REMOVE) {
      const removableEls = Array.from(rootEl.querySelectorAll(selector));

      for (const removableEl of removableEls) {
        removableEl.remove();
      }
    }
  }

  function removeUnimportantElements(rootEl) {
    const headlines = Array.from(rootEl.querySelectorAll("h2"));
    for (const headline of headlines) {
      const matches = headline.textContent
        .trim()
        .match(/^(See also|References|Conferences|Journals|Software|Sources|Further reading|External links)/gm);
      if (matches?.length > 0) {
        let nextSibling = headline.nextElementSibling;

        while (nextSibling && nextSibling.tagName.toLowerCase() !== "h2") {
          nextSibling.remove();
          nextSibling = headline.nextElementSibling;
        }

        headline.remove();
      }
    }
  }

  function cleanupTextContent(textContent) {
    return textContent.replace(/(\[edit\]|\[[0-9]+\])/gm, "");
  }

  const rootEl = document.createElement("div");
  rootEl.innerHTML = document.querySelector("#bodyContent").innerHTML;

  removeUnusedTags(rootEl);
  removeUnimportantElements(rootEl);

  return cleanupTextContent(rootEl.textContent).trim();
}
