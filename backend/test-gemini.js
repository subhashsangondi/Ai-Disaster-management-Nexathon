
require('dotenv').config();

const { GoogleGenAI } = require('@google/genai');

const client = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

async function testGemini() {
  const start = performance.now();

  console.log('Testing Gemini...');
  console.log('Model:', process.env.GEMINI_MODEL);

  try {
    const response = await client.models.generateContent({
      model: process.env.GEMINI_MODEL,
      contents: 'Reply with exactly one word: OK',
      config: {
        maxOutputTokens: 100,
      },
    });

    console.log('Response:', response.text);
  } catch (error) {
    console.error('Error:', {
      name: error.name,
      status: error.status,
      message: error.message,
    });
  } finally {
    console.log(
      'Duration:',
      ((performance.now() - start) / 1000).toFixed(2),
      'seconds'
    );
  }
}

testGemini();
