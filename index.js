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

app.get('/', (req, res) => res.send('Cribtopia Voice Server running ✅'));

// Initial call handler
app.post('/voice', (req, res) => {
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" action="/respond" method="POST" speechTimeout="auto" language="en-US">
    <Say voice="Polly.Joanna">Hi, thanks for calling Cribtopia! I'm Rich, how can I help you today?</Say>
  </Gather>
  <Redirect>/voice</Redirect>
</Response>`;
  res.type('text/xml').send(twiml);
});

// Handle caller speech -> OpenAI -> respond
app.post('/respond', async (req, res) => {
  const callerSpeech = req.body.SpeechResult || '';
  const conversationHistory = req.body.conversationHistory || '';
  console.log('Caller said:', callerSpeech);

  let aiReply = "I'm sorry, I didn't catch that. Could you repeat that?";

  try {
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT }
    ];

    // Add conversation history if any
    if (conversationHistory) {
      const history = JSON.parse(decodeURIComponent(conversationHistory));
      messages.push(...history);
    }

    messages.push({ role: 'user', content: callerSpeech });

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages,
        max_tokens: 100,
        temperature: 0.8
      })
    });

    const data = await response.json();
    aiReply = data.choices?.[0]?.message?.content || aiReply;
    console.log('AI reply:', aiReply);

    // Update history
    const history = conversationHistory ? JSON.parse(decodeURIComponent(conversationHistory)) : [];
    history.push({ role: 'user', content: callerSpeech });
    history.push({ role: 'assistant', content: aiReply });
    // Keep last 10 messages only
    const trimmed = history.slice(-10);
    const encodedHistory = encodeURIComponent(JSON.stringify(trimmed));

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" action="/respond?conversationHistory=${encodedHistory}" method="POST" speechTimeout="auto" language="en-US">
    <Say voice="Polly.Joanna">${aiReply.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</Say>
  </Gather>
  <Redirect>/voice</Redirect>
</Response>`;
    res.type('text/xml').send(twiml);

  } catch (err) {
    console.error('Error:', err);
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" action="/respond" method="POST" speechTimeout="auto" language="en-US">
    <Say voice="Polly.Joanna">${aiReply}</Say>
  </Gather>
</Response>`;
    res.type('text/xml').send(twiml);
  }
});

app.listen(PORT, () => console.log(`🚀 Cribtopia Voice Server on port ${PORT}`));
