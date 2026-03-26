const express = require('express');
const WebSocket = require('ws');
const http = require('http');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const PORT = process.env.PORT || 8080;

const SYSTEM_PROMPT = `You are Rich, the AI voice assistant for Cribtopia LLC. You are on a live phone call.

Your personality:
- Warm, natural, conversational — like a real person
- Keep responses SHORT — 1 to 2 sentences max on a phone call
- Listen carefully and respond directly to what the person says
- Calm, confident, a little personality
- Never say you are an AI

About Cribtopia:
- Tech platform that eliminates real estate agents entirely
- Sellers list FREE, buyers submit offers online, contracts auto-generated
- No commissions. No agents. FSBO reinvented for the modern era
- Co-Founders: Theresa Yackel and Jeremy Page
- Phone: 409-454-9038 | Website: cribtopia.com

IMPORTANT: If the caller says they are Theresa, Resa, or the co-founder — drop the pitch completely and be warm and personal like talking to a friend.`;

// Health check
app.get('/', (req, res) => res.send('Cribtopia Voice Server running ✅'));

// Twilio webhook — incoming or outbound call answer
app.post('/voice', (req, res) => {
  const host = req.headers.host;
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://${host}/stream" />
  </Connect>
</Response>`;
  res.type('text/xml').send(twiml);
});

// Create HTTP server
const server = http.createServer(app);

// WebSocket server for Twilio Media Streams
const wss = new WebSocket.Server({ server, path: '/stream' });

wss.on('connection', (twilioWs) => {
  console.log('📞 New call connected');

  let openaiWs = null;
  let streamSid = null;
  let callStarted = false;

  // Connect to OpenAI Realtime API
  openaiWs = new WebSocket(
    'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01',
    {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'OpenAI-Beta': 'realtime=v1',
      },
    }
  );

  openaiWs.on('open', () => {
    console.log('🤖 OpenAI Realtime connected');

    // Configure the session
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

    // Send initial greeting
    openaiWs.send(JSON.stringify({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'The call just connected. Greet the caller warmly and briefly introduce yourself as Rich from Cribtopia.' }]
      }
    }));
    openaiWs.send(JSON.stringify({ type: 'response.create' }));
  });

  openaiWs.on('message', (data) => {
    const event = JSON.parse(data);

    if (event.type === 'response.audio.delta' && event.delta) {
      // Stream audio back to Twilio
      if (streamSid && twilioWs.readyState === WebSocket.OPEN) {
        twilioWs.send(JSON.stringify({
          event: 'media',
          streamSid,
          media: { payload: event.delta }
        }));
      }
    }

    if (event.type === 'response.audio_transcript.delta') {
      process.stdout.write(event.delta || '');
    }
  });

  openaiWs.on('error', (err) => console.error('OpenAI WS error:', err));
  openaiWs.on('close', () => console.log('OpenAI WS closed'));

  // Handle messages from Twilio
  twilioWs.on('message', (data) => {
    const msg = JSON.parse(data);

    if (msg.event === 'start') {
      streamSid = msg.start.streamSid;
      console.log('Stream started:', streamSid);
    }

    if (msg.event === 'media' && openaiWs && openaiWs.readyState === WebSocket.OPEN) {
      openaiWs.send(JSON.stringify({
        type: 'input_audio_buffer.append',
        audio: msg.media.payload
      }));
    }

    if (msg.event === 'stop') {
      console.log('Call ended');
      if (openaiWs) openaiWs.close();
    }
  });

  twilioWs.on('close', () => {
    console.log('Twilio WS closed');
    if (openaiWs) openaiWs.close();
  });
});

server.listen(PORT, () => {
  console.log(`🚀 Cribtopia Voice Server running on port ${PORT}`);
});
