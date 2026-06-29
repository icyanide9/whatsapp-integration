// Import Express.js
const express = require('express');
// Create an Express app
const app = express();
// Middleware to parse JSON bodies
app.use(express.json());

// Set port and tokens securely from environment variables
const port = process.env.PORT || 3000;
const verifyToken = process.env.VERIFY_TOKEN;

// 1. Route for Meta's GET verification handshake
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('WEBHOOK VERIFIED');
    res.status(200).send(challenge);
  } else {
    res.status(403).end();
  }
});

// 2. Route for Meta's POST requests (Real incoming WhatsApp messages)
app.post('/webhook', (req, res) => {
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`\n\nWebhook received ${timestamp}\n`);
  console.log(JSON.stringify(req.body, null, 2));

  const body = req.body;

  // Verify this is a WhatsApp event payload
  if (body.object === 'whatsapp_business_account') {
    if (body.entry && body.entry[0].changes && body.entry[0].changes[0].value.messages) {
      const message = body.entry[0].changes[0].value.messages[0];
      const from = message.from;
      const msgBody = message.text ? message.text.body : "[Non-text message]";
      
      console.log(`👉 Real Message Received from ${from}: "${msgBody}"`);
    }
    // Always return a 200 OK to Meta so they know you processed it
    res.status(200).end();
  } else {
    res.status(404).end();
  }
});

// 3. Optional fallback placeholder for the root domain page
app.get('/', (req, res) => {
  res.send('WhatsApp Webhook Server is Alive and Running!');
});

// Start the server
app.listen(port, () => {
  console.log(`\nListening on port ${port}\n`);
});
