
require('dotenv').config();

const { GoogleGenAI } = require('@google/genai');

const client = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

async function listModels() {
  try {
    const models = await client.models.list();

    for await (const model of models) {
      const name = model.name || '';

      if (
        name.includes('gemini') &&
        !name.includes('tts') &&
        !name.includes('image') &&
        !name.includes('computer-use') &&
        !name.includes('robotics')
      ) {
        console.log(name);
      }
    }
  } catch (error) {
    console.error('Error:', {
      status: error.status,
      message: error.message,
    });
  }
}

listModels();

