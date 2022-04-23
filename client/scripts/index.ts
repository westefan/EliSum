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
  private static isWikipediaUrl(url: string | undefined): boolean {
    return !!url && url?.includes('en.wikipedia.org');
  }

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

  private _updateLoading(isLoading: boolean): void {
    const img = document.querySelector<HTMLImageElement>('#logo');
    if (!img) return;

    isLoading ? img.classList.add('loading') : img.classList.remove('loading');
  }

  private async _initSubmitButton(): Promise<void> {
    if (!this.submit) return;

    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    this.submit.innerHTML = EliSumPopup.isYoutubeUrl(tab.url)
      ? 'Parse YouTube transcript'
      : EliSumPopup.isWikipediaUrl(tab.url)
      ? 'Parse Wikipedia article'
      : 'Parse from text selection';
  }

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
            func: this._parseWikipediaArticleContent
          },
          async (result) => {
            if (!this.sourceOutput || !this.summaryOutput) {
              this._updateLoading(false);

              return;
            }

            this.sourceOutput.innerHTML = result[0].result;
            this._updateLoading(false);
          }
        );

        return;
      }

      if (EliSumPopup.isYoutubeUrl(tab.url)) {
        chrome.scripting.executeScript(
          {
            target: {tabId: tab.id},
            func: this._getYoutubeTranscript
          },
          async (result) => {
            if (!result[0] || result[0].result === 'PARSING_FAILED' || !this.sourceOutput || !this.summaryOutput) {
              this._updateLoading(false);

              return;
            }

            const resultJson = result[0].result as YoutubeTranscriptEntry[];

            const plainText = resultJson.map((v) => v.text).join(' ');
            const sourceOutput = document.getElementById('source-output');

            /*const summarizeResult = await summarize(plainText);
            document.getElementById('summary-output').innerHTML = summarizeResult.choices[0].text;*/

            for (const section of resultJson) {
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
                func: this._changeYoutubeStartUrl,
                args: [parseInt(start, 10)]
              });
            });
          }
        );

        return;
      }

      chrome.scripting.executeScript(
        {
          target: {tabId},
          func: this._getSelectionText
        },
        async (result) => {
          if (
            !result[0] ||
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

  private async _summarize(text: string): Promise<Summary> {
    const response = await fetch('http://localhost:3000/summarize', {
      method: 'POST',
      body: JSON.stringify({text}),
      headers: {'Content-type': 'application/json; charset=UTF-8'}
    });
    return await response.json();
  }

  private _getSelectionText(): string {
    return window.getSelection()?.toString() || '';
  }

  private _changeYoutubeStartUrl(start: number) {
    const url = new URL(window.location.href);
    const searchParams = new URLSearchParams(url.search);
    searchParams.set('t', start.toString());
    url.search = searchParams.toString();
    window.location = url.toString() as any;
  }

  private async _getYoutubeTranscript() {
    /**
     * Modified version from David Walsh XML2JSON https://davidwalsh.name/convert-xml-json
     */
    function xmlToJson(xml: any): any {
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
            obj[nodeName] = xmlToJson(item);
          } else {
            if (typeof obj[nodeName].push === 'undefined') {
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
        rawHtml.split('"captions":')[1].split(',"videoDetails')[0].replace('\n', '')
      ).playerCaptionsTracklistRenderer;
      const timedTextUrl = captions.captionTracks[0].baseUrl;
      console.debug(captions);

      const response = await fetch(timedTextUrl);
      const text = await response.text();
      const xml = new window.DOMParser().parseFromString(text, 'text/xml');
      const json = xmlToJson(xml);

      return json.transcript.text;
    } catch (e) {
      console.error(e);
      return 'PARSING_FAILED';
    }
  }

  private _parseWikipediaArticleContent(): string | undefined {
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

    function cleanupTextContent(textContent: string) {
      return textContent.replace(/(\[edit\]|\[[0-9]+\])/gm, '');
    }

    const rootEl = document.createElement('div');
    if (!rootEl || !rootEl.textContent) return;

    rootEl.innerHTML = document.querySelector<HTMLElement>('#bodyContent')?.innerHTML ?? '';

    removeUnusedTags(rootEl);
    removeUnimportantElements(rootEl);

    return cleanupTextContent(rootEl.textContent).trim();
  }
}

window.addEventListener('DOMContentLoaded', () => new EliSumPopup());
