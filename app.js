const express = require('express');
const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;

// 1. Handshake verification (GET)
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('WEBHOOK_VERIFIED');
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  }
});

// 2. Receiving live messages (POST)
app.post('/webhook', (req, res) => {
  const body = req.body;

  console.log('Incoming Webhook Payload:', JSON.stringify(body, null, 2));

  if (body.object === 'whatsapp_business_account') {
    if (body.entry && body.entry[0].changes && body.entry[0].changes[0].value.messages) {
      const message = body.entry[0].changes[0].value.messages[0];
      const from = message.from; // Your personal phone number
      const msgBody = message.text ? message.text.body : "";

      console.log(`Received message from ${from}: ${msgBody}`);
      
      // The webhook successfully received your message! 
      // You can add logic here later to reply back using WHATSAPP_TOKEN.
    }
    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
});

// Root URL placeholder to prevent 403 home errors
app.get('/', (req, res) => {
  res.send('WhatsApp Webhook Server is Live and Running!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});
