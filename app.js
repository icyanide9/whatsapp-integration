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
const axios = require('axios'); // Make sure to run 'npm install axios'

app.post('/webhook', async (req, res) => {
  const body = req.body;

  if (body.object === 'whatsapp_business_account') {
    if (body.entry && body.entry[0].changes && body.entry[0].changes[0].value.messages) {
      const message = body.entry[0].changes[0].value.messages[0];
      const from = message.from; 
      const msgBody = message.text ? message.text.body : "";

      console.log(`👉 Real Message Received from ${from}: "${msgBody}"`);

      // NEW: Send the echo reply back
      try {
        await axios({
          method: 'POST',
          url: `https://graph.facebook.com/v25.0/${process.env.PHONE_NUMBER_ID}/messages`,
          headers: {
            'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
            'Content-Type': 'application/json'
          },
          data: {
            messaging_product: 'whatsapp',
            to: from,
            text: { body: `Echo: ${msgBody}` }
          }
        });
        console.log(`✅ Echo sent successfully to ${from}`);
      } catch (error) {
        console.error('❌ Error sending message:', error.response ? error.response.data : error.message);
      }
    }
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
