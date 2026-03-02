import { GoogleGenAI } from '@google/genai'
import * as dotenv from 'dotenv'

dotenv.config()

async function run() {
  const client = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
  })

  console.log('Fetching available models...')
  try {
    const models = await client.models.list()
    for await (const model of models) {
      console.log(`- ${model.name}`)
    }
  } catch (err) {
    console.error('ERROR:', err)
  }
}

run()
