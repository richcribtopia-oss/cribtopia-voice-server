const express = require('express');
const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const PORT = process.env.PORT || 8080;

const SYSTEM_PROMPT = `You are Rich, the AI voice assistant for Cribtopia LLC. You are on a live phone call.
- Keep responses SHORT — 1 to 2 sentences max
- Warm, natural, conversational
- Never say you are an AI
- About Cribtopia: Tech platform eliminating real estate agents. Sellers list FREE, buyers submit offers online, no commissions, no agents. FSBO reinvented.
- Co-Founders: Theresa Yackel and Jeremy Page. Phone: 409-454-9038. Website: cribtopia.com
- If caller is Theresa or Resa, be warm and personal like a friend.`;

app.get('/', (req, res) => res.send('Cribtopia Voice Server v7 ✅'));

app.post('/voice', (req, res) => {
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" action="/respond" method="POST" timeout="10" speechTimeout="auto" language="en-US">
    <Say voice="Polly.Matthew-Neural">Hey, thanks for calling Cribtopia! This is Rich, how can I help you?</Say>
  </Gather>
  <Redirect>/voice</Redirect>
</Response>`;
  res.type('text/xml').send(twiml);
});

app.post('/respond', async (req, res) => {
  const callerSpeech = req.body.SpeechResult || '';
  const conversationHistory = req.body.conversationHistory || '';
  console.log('Caller said:', callerSpeech);

  let aiReply = "I'm having a little trouble on my end. Could you say that again?";

  try {
    if (callerSpeech.trim().length > 0) {
      const messages = [{ role: 'system', content: SYSTEM_PROMPT }];
      if (conversationHistory) {
        try { messages.push(...JSON.parse(decodeURIComponent(conversationHistory))); } catch(e) {}
      }
      messages.push({ role: 'user', content: callerSpeech });

      const gptRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${OPENAI_API_KEY}`, 
          'Content-Type': 'application/json' 
        },
        body: JSON.stringify({ model: 'gpt-4o-mini', messages, max_tokens: 80, temperature: 0.8 })
      });
      const gptData = await gptRes.json();
      aiReply = gptData.choices?.[0]?.message?.content || aiReply;
      console.log('AI reply:', aiReply);
    }

    const history = conversationHistory ? JSON.parse(decodeURIComponent(conversationHistory)) : [];
    if (callerSpeech) {
      history.push({ role: 'user', content: callerSpeech });
      history.push({ role: 'assistant', content: aiReply });
    }
    const encodedHistory = encodeURIComponent(JSON.stringify(history.slice(-10)));
    const safeReply = aiReply.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" action="/respond?conversationHistory=${encodedHistory}" method="POST" timeout="10" speechTimeout="auto" language="en-US">
    <Say voice="Polly.Matthew-Neural">${safeReply}</Say>
  </Gather>
  <Redirect>/voice</Redirect>
</Response>`;
    res.type('text/xml').send(twiml);

  } catch (err) {
    console.error('GPT Error:', err);
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" action="/respond" method="POST" timeout="10" speechTimeout="auto" language="en-US">
    <Say voice="Polly.Matthew-Neural">Sorry about that. How can I help you with Cribtopia?</Say>
  </Gather>
</Response>`;
    res.type('text/xml').send(twiml);
  }
});

app.listen(PORT, () => console.log(`🚀 Cribtopia Voice Server v7 on port ${PORT}`));
