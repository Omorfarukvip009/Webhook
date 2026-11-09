const express = require('express');
const app = express();

app.use(express.json());

// Map word forms of digits to numeric digits
const wordToDigit = {
  'zero': '0', 'one': '1', 'two': '2', 'three': '3', 'four': '4',
  'five': '5', 'six': '6', 'seven': '7', 'eight': '8', 'nine': '9'
};

app.post('/webhook', (req, res) => {
  const payload = req.body;

  console.log('--- INCOMING WEBHOOK PAYLOAD ---');
  console.log(JSON.stringify(payload, null, 2));

  const transcript = payload.data?.transcript || '';
  const callId = payload.data?.callId;

  // Regex matches phrases like "press 9", "press nine", "press zero", etc.
  const regex = /press\s+([0-9]|zero|one|two|three|four|five|six|seven|eight|nine)/i;
  const match = transcript.toLowerCase().match(regex);

  if (match) {
    const rawValue = match[1];
    const digitToPress = wordToDigit[rawValue] || rawValue;

    console.log(`[ACTION] Successfully parsed digit '${digitToPress}' for Call ID: ${callId}`);

    const responsePayload = {
      action: 'send_digits',
      digits: digitToPress,
      callId: callId
    };

    console.log('--- RESPONSE SENT ---');
    console.log(JSON.stringify(responsePayload, null, 2));

    return res.status(200).json(responsePayload);
  }

  console.log('[INFO] No "press digit" command found in transcript.');
  return res.status(200).json({ status: 'ignored' });
});

// Use Render's dynamic port assignment
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Webhook server running on port ${PORT}`);
});
