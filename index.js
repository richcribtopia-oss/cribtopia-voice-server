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

app.get('/', (req, res) => res.send('Cribtopia Voice Server v6 ✅'));

// Step 1: Answer and record caller
app.post('/voice', (req, res) => {
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Matthew-Neural">Hey, thanks for calling Cribtopia! This is Rich. Go ahead and speak after the beep.</Say>
  <Record action="/transcribe" method="POST" maxLength="15" playBeep="true" trim="trim-silence" />
</Response>`;
  res.type('text/xml').send(twiml);
});

// Step 2: Get recording, transcribe with Whisper, reply with GPT
app.post('/transcribe', async (req, res) => {
  const recordingUrl = req.body.RecordingUrl;
  const conversationHistory = req.body.conversationHistory || '';
  console.log('Recording URL:', recordingUrl);

  let callerSpeech = '';
  let aiReply = "Sorry, I had trouble hearing that. Could you try again?";

  try {
    // Download the recording
    const recordingResponse = await fetch(recordingUrl + '.mp3', {
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64')
      }
    });
    const audioBuffer = await recordingResponse.arrayBuffer();
    const audioBlob = new Blob([audioBuffer], { type: 'audio/mpeg' });

    // Transcribe with Whisper
    const formData = new FormData();
    formData.append('file', audioBlob, 'audio.mp3');
    formData.append('model', 'whisper-1');

    const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` },
      body: formData
    });
    const whisperData = await whisperRes.json();
    callerSpeech = whisperData.text || '';
    console.log('Whisper transcript:', callerSpeech);

    if (callerSpeech.trim().length > 0) {
      const messages = [{ role: 'system', content: SYSTEM_PROMPT }];
      if (conversationHistory) {
        try { messages.push(...JSON.parse(decodeURIComponent(conversationHistory))); } catch(e) {}
      }
      messages.push({ role: 'user', content: callerSpeech });

      const gptRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
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
  <Say voice="Polly.Matthew-Neural">${safeReply}</Say>
  <Record action="/transcribe?conversationHistory=${encodedHistory}" method="POST" maxLength="15" playBeep="true" trim="trim-silence" />
</Response>`;
    res.type('text/xml').send(twiml);

  } catch (err) {
    console.error('Error:', err);
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Matthew-Neural">Sorry about that. How can I help you with Cribtopia?</Say>
  <Record action="/transcribe" method="POST" maxLength="15" playBeep="true" trim="trim-silence" />
</Response>`;
    res.type('text/xml').send(twiml);
  }
});

app.listen(PORT, () => console.log(`🚀 Cribtopia Voice Server v6 on port ${PORT}`));
