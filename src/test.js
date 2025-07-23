require('dotenv').config();
const OpenAI = require('openai');
const openai = new OpenAI({ apiKey: process.env.GROK_API_KEY, baseURL: 'https://api.x.ai/v1' });
async function test() {
  const res = await openai.chat.completions.create({
    model: 'grok-3-mini',
    messages: [{ role: 'system', content: 'You are helpful.' }, { role: 'user', content: 'Hi' }],
    max_tokens: 300,
  });
  console.log(res);
}
test();