const https = require('https');

function httpsPost(url, headers, body) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'GEMINI_API_KEY is not set. Go to Netlify → Site configuration → Environment variables and add it.' })
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const { url, options, prompt } = body;
  if (!url) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing url parameter' }) };
  }

  const finalPrompt = prompt || `You are an expert SEO auditor. Perform a comprehensive SEO audit for: ${url}. Respond with ONLY valid JSON.`;

  const requestBody = JSON.stringify({
    contents: [{ parts: [{ text: finalPrompt }] }],
    generationConfig: { maxOutputTokens: 3000 },
  });

  try {
    const response = await httpsPost(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      { 'Content-Type': 'application/json' },
      requestBody
    );

    if (response.status !== 200) {
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: `Gemini API returned ${response.status}: ${response.body}` })
      };
    }

    const data = JSON.parse(response.body);
    const text = data.candidates[0].content.parts.map(p => p.text || '').join('');
    const clean = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Function crashed: ' + err.message })
    };
  }
};
