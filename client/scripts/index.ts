interface YoutubeTranscriptEntry {
  text: string;
  start: number;
  duration: number;
}

interface Summary {
  choices: SummaryChoice[];
}

interface SummaryChoice {
  text: string;
}

class EliSumPopup {
  /**
   * If the url is not undefined and includes 'en.wikipedia.org', then return true
   * @param {string | undefined} url - The URL of the Wikipedia page.
   * @returns A boolean value.
   */
  private static isWikipediaUrl(url: string | undefined): boolean {
    return !!url && url?.includes('en.wikipedia.org');
  }

  /**
   * If the url is not undefined and it includes the string 'youtube.com', then return true
   * @param {string | undefined} url - The URL of the video.
   * @returns A boolean value.
   */
  private static isYoutubeUrl(url: string | undefined): boolean {
    return !!url && url.includes('youtube.com');
  }

  submit = document.querySelector<HTMLButtonElement>('#submit');
  sourceOutput = document.querySelector<HTMLParagraphElement>('#source-output');
  summaryOutput = document.querySelector<HTMLParagraphElement>('#summary-output');

  constructor() {
    this._initSubmitButton();
    this._initEventHandler();
  }

  /**
   * If the image exists, add or remove the loading class based on the isLoading parameter
   * @param {boolean} isLoading - boolean - This is a boolean value that indicates whether the app is
   * loading or not.
   * @returns The return value of the function is the return value of the last statement in the
   * function.
   */
  private _updateLoading(isLoading: boolean): void {
    const img = document.querySelector<HTMLImageElement>('#logo');
    if (!img) return;

    isLoading ? img.classList.add('loading') : img.classList.remove('loading');
  }

  /**
   * It checks if the current tab is a YouTube or Wikipedia page, and if so, changes the text of the
   * submit button to reflect that
   * @returns The return value of the function is the value of the last expression in the function
   * body.
   */
  private async _initSubmitButton(): Promise<void> {
    if (!this.submit) return;

    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    this.submit.innerHTML = EliSumPopup.isYoutubeUrl(tab.url)
      ? 'Parse YouTube transcript'
      : EliSumPopup.isWikipediaUrl(tab.url)
      ? 'Parse Wikipedia article'
      : 'Parse from text selection';
  }

  /**
   * It initializes the event handler for the submit button
   * @returns a promise that resolves to void.
   */
  private async _initEventHandler(): Promise<void> {
    if (!this.submit) return;

    this.submit.addEventListener('click', async () => {
      this._updateLoading(true);
      const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
      if (!tab.id) {
        return;
      }
      const tabId = tab.id;

      if (EliSumPopup.isWikipediaUrl(tab.url)) {
        chrome.scripting.executeScript(
          {
            target: {tabId},
            func: parseWikipediaArticleContent
          },
          async (result) => {
            if (!this.sourceOutput || !this.summaryOutput || !result) {
              this._updateLoading(false);

              return;
            }

            const summarizeResult = await this._summarize(result[0].result);
            this.summaryOutput.innerHTML = summarizeResult.choices[0].text;

            this.sourceOutput.innerHTML = result[0].result;
            this._updateLoading(false);
          }
        );

        return;
      }

      if (EliSumPopup.isYoutubeUrl(tab.url)) {
        if (!tab.url) return;

        const result = await this._getYoutubeTranscript(tab.url);

        if (result === 'PARSING_FAILED' || !this.sourceOutput || !this.summaryOutput) {
          this._updateLoading(false);

          return;
        }

        const transcript = result as YoutubeTranscriptEntry[];
        const plainText = transcript.map((v: YoutubeTranscriptEntry) => v.text).join(' ');
        const summarizeResult = await this._summarize(plainText);

        this.summaryOutput.innerHTML = summarizeResult.choices[0].text;

        for (const section of transcript) {
          const span = document.createElement('span');
          span.innerHTML = section.text + '&nbsp;';
          span.setAttribute('data-start', Math.floor(section.start).toString());
          this.sourceOutput.appendChild(span);
        }

        this._updateLoading(false);

        this.sourceOutput.addEventListener('click', (event) => {
          const start = (event.target as HTMLElement).getAttribute('data-start');
          if (!start) {
            return;
          }

          chrome.scripting.executeScript({
            target: {tabId},
            func: changeYoutubeStartUrl,
            args: [parseInt(start, 10)]
          });
        });

        return;
      }

      chrome.scripting.executeScript(
        {
          target: {tabId},
          func: getSelectionText
        },
        async (result) => {
          if (
            !result[0] ||
            !result[0].result ||
            result[0].result === 'PARSING_FAILED' ||
            result[0].result.length === 0 ||
            !this.sourceOutput ||
            !this.summaryOutput
          ) {
            this._updateLoading(false);

            return;
          }

          const rawText = result[0].result;
          const summarizeResult = await this._summarize(rawText);

          this.summaryOutput.innerHTML = summarizeResult.choices[0].text;
          this.sourceOutput.innerHTML = rawText;

          this._updateLoading(false);
        }
      );
    });
  }

  /**
   * It sends a POST request to the server with the text to summarize, and returns the response as a
   * JSON object
   * @param {string} text - The text to summarize.
   * @returns A promise that resolves to a Summary object.
   */
  private async _summarize(text: string): Promise<Summary> {
    const response = await fetch('http://localhost:3000/summarize', {
      method: 'POST',
      body: JSON.stringify({text}),
      headers: {'Content-type': 'application/json; charset=UTF-8'}
    });
    return await response.json();
  }

  /**
   * It fetches the current page, extracts the captions from the HTML, fetches the captions as XML,
   * converts the XML to JSON and returns the transcript
   * @returns The transcript of the video.
   */
  private async _getYoutubeTranscript(url: string): Promise<YoutubeTranscriptEntry[] | string> {
    try {
      // fetch new site as raw text to escape potential bug when navigating in YT's SPA
      const siteResponse = await fetch(url);
      const rawHtml = await siteResponse.text();
      const captions = JSON.parse(
        rawHtml.split('"captions":')[1].split(',"videoDetails')[0].replace('\n', '')
      ).playerCaptionsTracklistRenderer;
      const timedTextUrl = captions.captionTracks[0].baseUrl;
      console.debug(captions);

      const response = await fetch(timedTextUrl);
      const text = await response.text();
      const xml = new window.DOMParser().parseFromString(text, 'text/xml');
      const json = this._xmlToJson(xml);

      return json.transcript.text;
    } catch (e) {
      console.error(e);
      return 'PARSING_FAILED';
    }
  }
  /**
   * Modified version from David Walsh XML2JSON https://davidwalsh.name/convert-xml-json
   */
  private _xmlToJson(xml: any): any {
    var obj: any = {};

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
        var nodeName = item.nodeName.replace(/^#/, '');
        if (typeof obj[nodeName] === 'undefined') {
          obj[nodeName] = this._xmlToJson(item);
        } else {
          if (typeof obj[nodeName].push === 'undefined') {
            var old = obj[nodeName];
            obj[nodeName] = [];
            obj[nodeName].push(old);
          }
          obj[nodeName].push(this._xmlToJson(item));
        }
      }
    }
    return obj;
  }
}

window.addEventListener('DOMContentLoaded', () => new EliSumPopup());

/**
 * If window.getSelection() returns a value, then return that value's toString() method, otherwise
 * return an empty string
 * @returns A string.
 */
function getSelectionText(): string {
  return window.getSelection()?.toString() || '';
}

/**
 * It removes all the unnecessary elements from the Wikipedia article and returns the cleaned up text
 * content
 * @returns The text content of the Wikipedia article.
 */
function parseWikipediaArticleContent(): string | undefined {
  /**
   * It removes all the elements that match the given selectors from the given root element
   * @param {HTMLElement} rootEl - HTMLElement
   */
  function removeUnusedTags(rootEl: HTMLElement): void {
    const SELECTORS_TO_REMOVE = [
      'style',
      'noscript',
      'script',
      '.reflist',
      '#toc',
      'table.sidebar',
      '[style*="display:none"]',
      '[style*="display: none"]',
      '.printfooter',
      '#siteSub',
      '.mw-jump-link',
      '.hatnote',
      '#mw-normal-catlinks',
      '#mw-hidden-catlinks'
    ];
    for (const selector of SELECTORS_TO_REMOVE) {
      const removableEls = Array.from(rootEl.querySelectorAll<HTMLElement>(selector));

      for (const removableEl of removableEls) {
        removableEl.remove();
      }
    }
  }

  /**
   * It removes all elements between a heading and the next heading
   * @param {HTMLElement} rootEl - HTMLElement - The root element of the page.
   * @returns the first element that matches the selector.
   */
  function removeUnimportantElements(rootEl: HTMLElement): void {
    const headlines = Array.from(rootEl.querySelectorAll<HTMLElement>('h2'));
    for (const headline of headlines) {
      if (!headline.textContent) return;

      const matches = headline.textContent
        .trim()
        .match(/^(See also|References|Conferences|Journals|Software|Sources|Further reading|External links)/gm);
      if (matches && matches.length > 0) {
        let nextSibling = headline.nextElementSibling;

        while (nextSibling && nextSibling.tagName.toLowerCase() !== 'h2') {
          nextSibling.remove();
          nextSibling = headline.nextElementSibling;
        }

        headline.remove();
      }
    }
  }

  /**
   * It takes a string and removes all instances of the string "[edit]" and "[number]" from it
   * @param {string} textContent - The text content of the Wikipedia page.
   * @returns The textContent is being returned with the [edit] and [number] tags removed.
   */
  function cleanupTextContent(textContent: string): string {
    return textContent.replace(/(\[edit\]|\[[0-9]+\])/gm, '');
  }

  const rootEl = document.createElement('div');
  rootEl.innerHTML = document.querySelector<HTMLElement>('#bodyContent')?.innerHTML ?? '';

  if (!rootEl || !rootEl.textContent) return;

  removeUnusedTags(rootEl);
  removeUnimportantElements(rootEl);

  return cleanupTextContent(rootEl.textContent).trim();
}

/**
 * It takes a number, and changes the URL to the current page to include that number as the start
 * time
 * @param {number} start - The time in seconds to start the video at.
 */
function changeYoutubeStartUrl(start: number): void {
  const url = new URL(window.location.href);
  const searchParams = new URLSearchParams(url.search);
  searchParams.set('t', start.toString());
  url.search = searchParams.toString();
  window.location = url.toString() as any;
}
