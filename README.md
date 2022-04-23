# EliSum
_Eli5 + Sum up = EliSum_

Web extension that summarizes web content in a simple way. Following options are available to summarize:
- Text selection
- Wikipedia articles
- Youtube videos

# Getting started
Run the following command to install dependencies:
```bash
npm i
```
## Server
Set environment variable for `OPENAI_KEY` to a valid API key from https://beta.openai.com/account/api-keys

Start the server with:
```bash
npm start
```

## Extension
Build the extension with:
```bash
npm run build
```
Install the extension:
- Open the chrome extension page: [chrome://extensions/](chrome://extensions/)
- Activate developer mode with the switch on the top right
- Select 'Load unpacked' and select the built extension folder: `elisum/dist`

# Limitations
Due to API usage limitations, this tool just parses up to 1000 words at once

---
---
### Note
All code documentations were auto generated via [Mintlify](https://www.mintlify.com/)
### TODO
- Use SASS
- Create context menu to summarize selection text
- Create own summarize solution 