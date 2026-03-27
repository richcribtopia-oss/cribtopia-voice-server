const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const PORT = process.env.PORT || 8080;

const SYSTEM_PROMPT = `You are Rich, the AI voice assistant for Cribtopia LLC. You help people on a live phone call.

Your personality:
- Warm, natural, conversational — like a real person
- Keep responses SHORT — 1 to 2 sentences max on a phone call
- Listen carefully and respond directly to what the person says
- Calm, confident, friendly
- Never say you are an AI unless directly asked

About Cribtopia:
- Tech platform that eliminates real estate agents entirely
- Sellers list FREE, buyers submit offers online, contracts auto-generated
- No commissions. No agents. FSBO reinvented for the modern era
- Co-Founders: Theresa Yackel and Jeremy Page
- Phone: 409-454-9038 | Website: cribtopia.com

If the caller says they are Theresa, Resa, or the co-founder — be warm and personal like talking to a friend.`;

app.get('/', (req, res) => res.send('Cribtopia Voice Server running ✅'));

// Twilio incoming call — start media stream
app.post('/voice', (req, res) => {
  const host = req.headers.host;
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">Please hold while I connect you to Rich, the Cribtopia AI assistant.</Say>
  <Connect>
    <Stream url="wss://${host}/stream" />
  </Connect>
</Response>`;
  res.type('text/xml').send(twiml);
});

// Create HTTP server with WebSocket upgrade support
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/stream' });

wss.on('connection', (twilioWs) => {
  console.log('📞 Call connected');

  let openaiWs = null;
  let streamSid = null;

  openaiWs = new WebSocket(
    'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17',
    {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'OpenAI-Beta': 'realtime=v1',
      },
    }
  );

  openaiWs.on('open', () => {
    console.log('✅ OpenAI connected');
    openaiWs.send(JSON.stringify({
      type: 'session.update',
      session: {
        turn_detection: { type: 'server_vad' },
        input_audio_format: 'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        voice: 'alloy',
        instructions: SYSTEM_PROMPT,
        modalities: ['text', 'audio'],
        temperature: 0.85,
      }
    }));

    // Trigger greeting
    openaiWs.send(JSON.stringify({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'The call just connected. Say a short warm greeting as Rich from Cribtopia.' }]
      }
    }));
    openaiWs.send(JSON.stringify({ type: 'response.create' }));
  });

  openaiWs.on('message', (data) => {
    try {
      const event = JSON.parse(data);

      if (event.type === 'response.audio.delta' && event.delta) {
        if (streamSid && twilioWs.readyState === WebSocket.OPEN) {
          twilioWs.send(JSON.stringify({
            event: 'media',
            streamSid,
            media: { payload: event.delta }
          }));
        }
      }

      if (event.type === 'error') {
        console.error('OpenAI error:', JSON.stringify(event.error));
      }
    } catch(e) {
      console.error('Parse error:', e);
    }
  });

  openaiWs.on('error', (err) => console.error('OpenAI WS error:', err.message));
  openaiWs.on('close', (code, reason) => console.log('OpenAI WS closed:', code, reason?.toString()));

  twilioWs.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.event === 'start') {
        streamSid = msg.start.streamSid;
        console.log('Stream started:', streamSid);
      }
      if (msg.event === 'media' && openaiWs?.readyState === WebSocket.OPEN) {
        openaiWs.send(JSON.stringify({
          type: 'input_audio_buffer.append',
          audio: msg.media.payload
        }));
      }
      if (msg.event === 'stop') {
        console.log('Call ended');
        openaiWs?.close();
      }
    } catch(e) {
      console.error('Twilio parse error:', e);
    }
  });

  twilioWs.on('close', () => {
    console.log('Twilio disconnected');
    openaiWs?.close();
  });

  twilioWs.on('error', (err) => console.error('Twilio WS error:', err.message));
});

server.listen(PORT, () => {
  console.log(`🚀 Cribtopia Voice Server on port ${PORT}`);
});
