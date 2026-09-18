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
    // 1. Immediately acknowledge Meta with 200 OK to prevent webhook retries/timeouts
    res.status(200).end();

    console.log("\n=======================================================");
    console.log("📥 [Meta Webhook] Inbound WhatsApp Event Received:");
    console.log(JSON.stringify(body, null, 2));

    if (body.entry && body.entry[0].changes && body.entry[0].changes[0].value.messages) {
      const message = body.entry[0].changes[0].value.messages[0];
      const from = message.from; // e.g. "917007449611"
      const msgBody = message.text ? message.text.body : "";
      const contactName = body.entry[0].changes[0].value.contacts?.[0]?.profile?.name || "Customer";

      console.log(`👉 Inbound Message from ${contactName} (${from}): "${msgBody}"`);

      // Skip non-text or empty messages
      if (!msgBody.trim()) {
        console.log("ℹ️ Empty message body or non-text message. Skipping communication logging.");
        console.log("=======================================================\n");
        return;
      }

      // 2. Generate unique Communication ID
      const communicationId = `WA-IN-${Date.now()}`;
      const customerPhone = from.startsWith('+') ? from : '+' + from;

      // 3. Target Action: Log Inbound WhatsApp Message
      const inboundActionName = process.env.CCL_INBOUND_ACTION_API_NAME || 'log-inbound-whats-app-message';
      const foundryUrl = `https://${process.env.FOUNDRY_HOSTNAME}/api/v2/ontologies/${process.env.ONTOLOGY_RID}/actions/${inboundActionName}/apply`;

      let payload = {
        parameters: {
          "communicationId": communicationId,
          "phone": customerPhone,
          "senderName": contactName,
          "messageText": msgBody
        }
      };

      console.log(`🏛️ Logging Inbound Communication in Foundry Ontology...`);
      console.log(`   Action: ${inboundActionName}`);
      console.log(`   Endpoint: ${foundryUrl}`);
      console.log(`   Payload:\n`, JSON.stringify(payload, null, 2));

      try {
        let foundryRes;
        try {
          foundryRes = await axios.post(foundryUrl, payload, {
            headers: {
              "Authorization": `Bearer ${process.env.FOUNDRY_API_TOKEN}`,
              "Content-Type": "application/json"
            }
          });
        } catch (firstErr) {
          // If camelCase failed due to parameter name format, auto-retry with kebab-case
          if (firstErr.response?.data?.errorCode === 'NOT_FOUND' || firstErr.response?.data?.errorName?.includes('Parameter')) {
            console.log("⚠️ Retrying with kebab-case parameters...");
            payload = {
              parameters: {
                "communication-id": communicationId,
                "phone": customerPhone,
                "sender-name": contactName,
                "message-text": msgBody
              }
            };
            foundryRes = await axios.post(foundryUrl, payload, {
              headers: {
                "Authorization": `Bearer ${process.env.FOUNDRY_API_TOKEN}`,
                "Content-Type": "application/json"
              }
            });
          } else {
            throw firstErr;
          }
        }

        console.log(`✅ Inbound Communication ${communicationId} successfully logged in Foundry Ontology!`);
        console.log(`   Foundry Response:`, JSON.stringify(foundryRes.data));
        console.log(`⚡ Foundry Automations will now trigger to match customer, check active tickets, and notify.`);

        // 4. Send Confirmation WhatsApp message back to the customer
        const replyText = `Hi ${contactName}! 👋\n\nWe received your message: "${msgBody}".\nOur property team has logged your inquiry (Reference: ${communicationId}) and will assist you shortly.`;

        try {
          const metaResponse = await axios({
            method: 'POST',
            url: `https://graph.facebook.com/v25.0/${process.env.PHONE_NUMBER_ID}/messages`,
            headers: {
              'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
              'Content-Type': 'application/json'
            },
            data: {
              messaging_product: 'whatsapp',
              to: from,
              text: { body: replyText }
            }
          });
          console.log(`✅ Confirmation message delivered to ${from}:`, metaResponse.data);
        } catch (metaErr) {
          console.warn(`⚠️ Could not send WhatsApp text reply (outside 24h window for curl test):`, metaErr.response?.data || metaErr.message);
        }
      } catch (error) {
        console.error('❌ Error logging communication in Foundry:', error.response ? error.response.data : error.message);
      }
    } else if (body.entry && body.entry[0].changes && body.entry[0].changes[0].value.statuses) {
      const status = body.entry[0].changes[0].value.statuses[0];
      console.log(`ℹ️ [Meta Status Update] Message ID ${status.id} status is now: "${status.status}" for recipient ${status.recipient_id}`);
    }
    console.log("=======================================================\n");
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

  // =========================================================================
  // 🛡️ Demo Outbound Filter: Ignore old STATUS-CMP-* noise
  // Only dispatch new intake confirmations (WA-OUT-CMP-WA* and WA-OUT-FOLLOWUP*)
  // =========================================================================
  const communication = req.body.communication || req.body;
  const communicationId = communication.communicationId || communication.communication_id || req.body.communicationId || req.body.communication_id;
  const direction = communication.direction || req.body.direction;
  const channel = communication.channel || req.body.channel;

  if (direction && direction !== 'Outbound') {
    console.log(`⏭️ [Demo Filter] Skipping non-outbound communication (direction: ${direction})`);
    console.log("=======================================================\n");
    return res.status(200).json({ skipped: true, reason: `Direction is "${direction}", expected "Outbound"` });
  }

  if (channel && channel !== 'WhatsApp') {
    console.log(`⏭️ [Demo Filter] Skipping non-WhatsApp communication (channel: ${channel})`);
    console.log("=======================================================\n");
    return res.status(200).json({ skipped: true, reason: `Channel is "${channel}", expected "WhatsApp"` });
  }

  // 1. Filter by communicationId: only send WA-OUT-CMP-WA* or WA-OUT-FOLLOWUP*
  if (communicationId) {
    const isAllowedIntake = communicationId.startsWith('WA-OUT-CMP-WA') || communicationId.startsWith('WA-OUT-FOLLOWUP');
    if (!isAllowedIntake) {
      console.log(`⏭️ [Demo Filter] Suppressing old status update communication (${communicationId}).`);
      console.log("=======================================================\n");
      return res.status(200).json({
        skipped: true,
        reason: `Ignored old status message (${communicationId}). Only WA-OUT-CMP-WA* and WA-OUT-FOLLOWUP* are dispatched for demo.`
      });
    }
  }

  // 2. Fallback check: Filter if templateParams explicitly reference STATUS-CMP-*
  if (Array.isArray(templateParams)) {
    const hasOldStatusParam = templateParams.some(p => typeof p === 'string' && p.includes('STATUS-CMP-'));
    if (hasOldStatusParam) {
      console.log(`⏭️ [Demo Filter] Suppressing dispatch with old STATUS-CMP params:`, templateParams);
      console.log("=======================================================\n");
      return res.status(200).json({
        skipped: true,
        reason: 'Ignored old STATUS-CMP update template params for demo.'
      });
    }
  }
  // =========================================================================

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

app.get('/test-inbound', async (req, res) => {
  const inboundActionName = process.env.CCL_INBOUND_ACTION_API_NAME || 'log-inbound-whats-app-message';
  const foundryUrl = `https://${process.env.FOUNDRY_HOSTNAME}/api/v2/ontologies/${process.env.ONTOLOGY_RID}/actions/${inboundActionName}/apply`;
  const communicationId = `TEST-WA-${Date.now()}`;

  let payload = {
    parameters: {
      "communicationId": communicationId,
      "phone": "+917007449611",
      "senderName": "Aryan Sharma (Test)",
      "messageText": "Testing inbound communication logging from curl"
    }
  };

  try {
    let response;
    try {
      response = await axios.post(foundryUrl, payload, {
        headers: {
          "Authorization": `Bearer ${process.env.FOUNDRY_API_TOKEN}`,
          "Content-Type": "application/json"
        }
      });
    } catch (err) {
      if (err.response?.data?.errorCode === 'NOT_FOUND' || err.response?.data?.errorName?.includes('Parameter')) {
        payload = {
          parameters: {
            "communication-id": communicationId,
            "phone": "+917007449611",
            "sender-name": "Aryan Sharma (Test)",
            "message-text": "Testing inbound communication logging from curl"
          }
        };
        response = await axios.post(foundryUrl, payload, {
          headers: {
            "Authorization": `Bearer ${process.env.FOUNDRY_API_TOKEN}`,
            "Content-Type": "application/json"
          }
        });
      } else {
        throw err;
      }
    }

    res.status(200).send("✅ Inbound Log Success: " + JSON.stringify(response.data));
  } catch (error) {
    console.error("❌ Inbound Test Error:", JSON.stringify(error.response?.data || error.message, null, 2));
    res.status(500).send("❌ Inbound Log Error: " + JSON.stringify(error.response?.data || error.message));
  }
});

// Start the server - explicitly bind to 0.0.0.0 for Render port detection
const HOST = '0.0.0.0';
app.listen(port, HOST, () => {
  console.log(`\n🚀 Server listening on ${HOST}:${port}\n`);
});
