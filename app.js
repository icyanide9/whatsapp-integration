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

app.get('/test-foundry', async (req, res) => {
  const foundryUrl = `https://${process.env.FOUNDRY_HOSTNAME}/api/v2/ontologies/${process.env.ONTOLOGY_RID}/actions/${process.env.CCL_ACTION_API_NAME}/apply`;

  // Define the payload clearly so we can log it
  const payload = {
    parameters: {
      "complaintId": "TEST-CW-22078-001",
      "customer": "ri.phonograph2-objects.main.object.v4.3a948240-6e98-4164-b28a-010a584263cb.AE_Z5PUMGXPCBX4PN9GKBLSKDINCB3AR9GJXNKTTTJWE", 
      "property": "ri.phonograph2-objects.main.object.v4.e28ca6d7-e106-4144-909e-0fcc33a1008a.AD9L8V85G5NIXKHE87DRTE50HAWSQ76FDYNMHVB0-XWF",
      "unit": "ri.phonograph2-objects.main.object.v4.c0220c99-6c62-4df3-bc54-498e4a233880.AYQK1CR4XDAAUCBNK1S_QWWUKMINLY3BI6BR-SQU5KWO",
      "description": "Test complaint for APT-22078 from Render bridge.",
      "sourceChannel": "WhatsApp"
    }
  };

  // Add the log here to verify the payload
  console.log("DEBUG PAYLOAD:", JSON.stringify(payload, null, 2));

  try {
    const response = await axios.post(foundryUrl, payload, {
      headers: {
        "Authorization": `Bearer ${process.env.FOUNDRY_API_TOKEN}`,
        "Content-Type": "application/json"
      }
    });
    
    res.status(200).send("✅ Success: " + JSON.stringify(response.data));
  } catch (error) {
    // This logs the full error details from Foundry in your Render logs
    console.error("❌ Foundry API Error Details:", JSON.stringify(error.response?.data, null, 2));
    res.status(500).send("❌ Error: " + JSON.stringify(error.response?.data || error.message));
  }
});
