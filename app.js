// Import Express.js
const express = require('express');
// Create an Express app
const app = express();
// Middleware to parse JSON bodies
app.use(express.json());

// Log every incoming request so Render logs show all traffic
app.use((req, res, next) => {
  console.log(`📡 [${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

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
    console.log("\n=======================================================");
    console.log("📥 [Meta Webhook] Inbound WhatsApp Event Received:");
    console.log(JSON.stringify(body, null, 2));

    if (body.entry && body.entry[0].changes && body.entry[0].changes[0].value.messages) {
      const message = body.entry[0].changes[0].value.messages[0];
      const from = message.from;
      const msgBody = message.text ? message.text.body : "";

      console.log(`👉 Inbound Message from ${from}: "${msgBody}"`);

      // Echo reply back
      try {
        const echoResponse = await axios({
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
        console.log(`✅ Echo sent successfully to ${from}:`, echoResponse.data);
      } catch (error) {
        console.error('❌ Error sending echo message:', error.response ? error.response.data : error.message);
      }
    } else if (body.entry && body.entry[0].changes && body.entry[0].changes[0].value.statuses) {
      const status = body.entry[0].changes[0].value.statuses[0];
      console.log(`ℹ️ [Meta Status Update] Message ID ${status.id} status is now: "${status.status}" for recipient ${status.recipient_id}`);
    }
    console.log("=======================================================\n");
    res.status(200).end();
  } else {
    res.status(404).end();
  }
});

// 3. Optional fallback placeholder for the root domain page
app.get('/', (req, res) => {
  res.send('WhatsApp Webhook Server is Alive and Running!');
});

// 4. Route for Foundry to trigger a WhatsApp update message to a customer
app.post('/foundry-webhook', async (req, res) => {
  const authHeader = req.headers['authorization'];
  const expectedToken = `Bearer ${process.env.FOUNDRY_WEBHOOK_SECRET}`;

  if (!authHeader || authHeader !== expectedToken) {
    console.warn("⚠️ Unauthorized request received on /foundry-webhook. Header:", authHeader ? "[Provided but invalid]" : "[Missing]");
    return res.status(401).json({ error: 'Unauthorized' });
  }

  console.log("\n=======================================================");
  console.log("📥 [Foundry Webhook] Outbound trigger received from Foundry");
  console.log("📦 Raw Request Body:\n", JSON.stringify(req.body, null, 2));

  const { customerPhone: rawPhone, templateName, templateParams } = req.body;

  console.log(`📋 Parsed Fields:`);
  console.log(`   - customerPhone (raw): ${JSON.stringify(rawPhone)}`);
  console.log(`   - templateName: ${JSON.stringify(templateName)}`);
  console.log(`   - templateParams (${Array.isArray(templateParams) ? templateParams.length : 0} items):`, templateParams);

  if (!rawPhone || !templateName) {
    console.error("❌ Validation Failed: Missing customerPhone or templateName");
    console.log("=======================================================\n");
    return res.status(400).json({ error: 'Missing customerPhone or templateName', received: req.body });
  }

  // Normalize phone: convert decimal/number to string and add '+' prefix if missing
  let customerPhone = String(rawPhone).trim();
  if (!customerPhone.startsWith('+')) {
    customerPhone = '+' + customerPhone;
  }

  // Check for invalid/placeholder phone strings like "Not provided" or empty digits
  const digitsOnly = customerPhone.replace(/\D/g, '');
  if (digitsOnly.length < 7 || customerPhone.toLowerCase().includes('not provided')) {
    console.error(`\n❌ [Foundry Webhook] Invalid recipient phone number: "${rawPhone}"`);
    console.error(`   👉 Reason: In Foundry, the Customer linked to this complaint has no valid phone number.`);
    console.error(`   👉 Fix: Open the Customer in Foundry Object Explorer and populate their 'Phone' property (e.g. +917007449611).\n`);
    console.log("=======================================================\n");
    return res.status(400).json({
      error: `Invalid customerPhone: "${rawPhone}". In Foundry, the linked Customer record has no valid phone number.`,
      receivedPhone: rawPhone,
      hint: "Set the customer's Phone property in Foundry Object Explorer."
    });
  }

  console.log(`📱 Normalized Target Phone: ${customerPhone}`);

  try {
    const components = templateParams && templateParams.length > 0
      ? [{
          type: 'body',
          parameters: templateParams.map((param, idx) => {
            console.log(`   🔹 Variable {{${idx + 1}}}: "${param}"`);
            return { type: 'text', text: String(param) };
          })
        }]
      : [];

    const metaPayload = {
      messaging_product: 'whatsapp',
      to: customerPhone,
      type: 'template',
      template: {
        name: templateName,
        language: { code: 'en_US' },
        components: components
      }
    };

    console.log(`🚀 Dispatching to Meta Graph API (v25.0 / Phone ID: ${process.env.PHONE_NUMBER_ID}):`);
    console.log(JSON.stringify(metaPayload, null, 2));

    const metaResponse = await axios({
      method: 'POST',
      url: `https://graph.facebook.com/v25.0/${process.env.PHONE_NUMBER_ID}/messages`,
      headers: {
        'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      },
      data: metaPayload
    });

    console.log(`✅ Meta API Response:`, JSON.stringify(metaResponse.data, null, 2));
    console.log(`✅ WhatsApp template message delivered successfully to ${customerPhone}`);
    console.log("=======================================================\n");

    res.status(200).json({ success: true, metaResponse: metaResponse.data });
  } catch (error) {
    const errorDetails = error.response ? error.response.data : error.message;
    console.error('❌ Error sending WhatsApp template message to Meta:');
    console.error(JSON.stringify(errorDetails, null, 2));
    console.log("=======================================================\n");
    res.status(500).json({ error: 'Failed to send WhatsApp message', details: errorDetails });
  }
});

app.get('/test-foundry', async (req, res) => {
  const foundryUrl = `https://${process.env.FOUNDRY_HOSTNAME}/api/v2/ontologies/${process.env.ONTOLOGY_RID}/actions/${process.env.CCL_ACTION_API_NAME}/apply`;

  // Define the payload with a dynamic unique complaint-id
  const uniqueId = `TEST-CW-${Date.now()}`;
  const payload = {
    parameters: {
      "complaint-id": uniqueId,
      "customer": "CUST-0090",
      "property": "PROP-DD-15",
      "unit": "UNIT-DD-0008",
      "complaint-description": "Test complaint from cURL",
      "source-channel": "WhatsApp"
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

// Start the server - explicitly bind to 0.0.0.0 for Render port detection
const HOST = '0.0.0.0';
app.listen(port, HOST, () => {
  console.log(`\n🚀 Server listening on ${HOST}:${port}\n`);
});
