const express = require('express');
const cors = require('cors');

const app = express();

const HOST = 'localhost';
const PORT = 3000;

const {Configuration, OpenAIApi} = require('openai');
const configuration = new Configuration({
  apiKey: process.env.OPENAI_KEY
});
const openai = new OpenAIApi(configuration);

async function summarize(input) {
  console.log(input);
  const response = await openai.createCompletion('text-curie-001', {
    prompt: `Summarize this for a second-grade student: ${input}`,
    temperature: 0.7,
    max_tokens: 300,
    stop: ''
  });

  return response.data;
}

summarize();

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
