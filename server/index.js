const express = require('express');
const cors = require('cors');

const app = express();

const HOST = 'localhost';
const PORT = 3000;
// Artificial token limiter
const TOKEN_LIMIT = 1000;
// const OPENAI_MODEL = 'text-curie-001';
const OPENAI_MODEL = 'text-davinci-002';

const {Configuration, OpenAIApi} = require('openai');
const configuration = new Configuration({
  apiKey: process.env.OPENAI_KEY
});
const openai = new OpenAIApi(configuration);

/**
 *  Using the OpenAI API to summarize the input text.
 */
async function summarize(input) {
  input = input.split(' ').slice(0, TOKEN_LIMIT).join(' ');

  const response = await openai.createCompletion(OPENAI_MODEL, {
    prompt: `Summarize this for a second-grade student: ${input}`,
    temperature: 0.7,
    max_tokens: 100,
    stop: ''
  });

  return response.data;
}

app.use((_, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});
app.use(cors({credentials: true}));
app.use(express.urlencoded({extended: false}));
app.use(express.json());

app.use('/hello', (_, res) => res.send('Hello world!'));
app.post('/summarize', async (req, res) => {
  res.end(JSON.stringify(await summarize(req.body.text)));
});

app.listen(PORT, HOST, () => console.info(`Starting sever at ${HOST}:${PORT}`));
