import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, '.env');
dotenv.config({ path: envPath, override: true });

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
const GEMINI_API_KEY = String(process.env.GEMINI_API_KEY || '').trim();
const gemini = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function cleanString(value, max = 300) {
  return String(value ?? '').trim().slice(0, max);
}

function normalizeBarcode(value) {
  return String(value ?? '').replace(/\D/g, '').trim();
}

function inferCategory(categories = [], name = '') {
  const text = `${categories.join(' ')} ${name}`.toLowerCase();
  const rules = [
    ['dairy', ['milk', 'leite', 'yogurt', 'iogurte', 'cream', 'creme', 'dairy']],
    ['cheese', ['cheese', 'queijo']],
    ['eggs', ['egg', 'ovo']],
    ['fruit', ['fruit', 'fruta', 'apple', 'banana', 'orange', 'mango', 'maçã']],
    ['vegetables', ['vegetable', 'legume', 'verdura', 'tomato', 'carrot', 'onion']],
    ['meat', ['meat', 'carne', 'beef', 'chicken', 'frango', 'pork', 'bacon', 'ham']],
    ['frozen', ['frozen', 'congelado']],
    ['snacks', ['snack', 'biscuit', 'cookie', 'chips', 'bolacha', 'biscoito']],
    ['beverage', ['beverage', 'drink', 'refrigerante', 'juice', 'suco', 'water', 'água']],
    ['grains', ['rice', 'arroz', 'pasta', 'massa', 'flour', 'farinha', 'cereal', 'grain']]
  ];
  for (const [category, keywords] of rules) {
    if (keywords.some((keyword) => text.includes(keyword))) return category;
  }
  return 'other';
}

function safeKeyPreview(key) {
  return key ? `${key.slice(0, 8)}...${key.slice(-4)}` : null;
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    aiConfigured: Boolean(GEMINI_API_KEY),
    provider: 'Google Gemini',
    model: GEMINI_MODEL,
    node: process.version,
    keyPreview: safeKeyPreview(GEMINI_API_KEY),
    hint: GEMINI_API_KEY
      ? 'Gemini API key loaded from the project .env file.'
      : 'Gemini API key NOT loaded. Create .env next to server.js and restart npm start.'
  });
});

app.get('/api/ai-test', async (_req, res) => {
  if (!gemini) {
    return res.status(503).json({
      ok: false,
      stage: 'configuration',
      error: 'GEMINI_API_KEY is not loaded. Check that .env is next to server.js and restart Shelﬂy.'
    });
  }

  try {
    const interaction = await gemini.interactions.create({
      model: GEMINI_MODEL,
      input: 'Reply with exactly: Shelﬂy Gemini is working.'
    });

    return res.json({
      ok: true,
      stage: 'gemini',
      provider: 'Google Gemini',
      model: GEMINI_MODEL,
      output: interaction.output_text || ''
    });
  } catch (error) {
    console.error('Gemini AI test failed:', error);
    return res.status(502).json({
      ok: false,
      stage: 'gemini',
      provider: 'Google Gemini',
      model: GEMINI_MODEL,
      error: error?.message || 'Unknown Gemini error',
      status: error?.status || null,
      code: error?.code || null,
      type: error?.name || null
    });
  }
});

async function fetchOpenFoodFactsProduct(barcode) {
  const endpoints = [
    `https://world.openfoodfacts.org/api/v3/product/${encodeURIComponent(barcode)}?product_type=food&cc=br&lc=pt&fields=product_name,product_name_en,product_name_pt,generic_name,brands,categories_tags,image_front_url,quantity`,
    `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}?product_type=food&cc=br&lc=pt&fields=product_name,product_name_en,product_name_pt,generic_name,brands,categories_tags,image_front_url,quantity`
  ];

  let lastHttpError = null;
  for (const url of endpoints) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Shelfly/1.1 (food inventory demo)' },
        redirect: 'follow'
      });

      if (response.status === 404) continue;
      if (!response.ok) {
        lastHttpError = new Error(`Open Food Facts returned HTTP ${response.status}.`);
        continue;
      }

      const data = await response.json();
      const product = data?.product;
      if (!product || data?.status === 'failure') continue;

      const name = cleanString(
        product.product_name_pt || product.product_name_en || product.product_name || product.generic_name || '',
        200
      );
      if (!name) continue;

      const categories = Array.isArray(product.categories_tags) ? product.categories_tags : [];
      return {
        barcode,
        name,
        brand: cleanString(product.brands, 150),
        quantity: cleanString(product.quantity, 100),
        category: inferCategory(categories, name),
        image: cleanString(product.image_front_url, 500),
        source: 'Open Food Facts'
      };
    } catch (error) {
      lastHttpError = error;
    }
  }

  if (lastHttpError) throw lastHttpError;
  return null;
}

app.get('/api/products/:barcode', async (req, res) => {
  const barcode = normalizeBarcode(req.params.barcode);
  if (barcode.length < 8 || barcode.length > 14) {
    return res.status(400).json({ found: false, error: 'Please enter a valid product barcode.' });
  }

  try {
    const product = await fetchOpenFoodFactsProduct(barcode);
    if (!product) return res.json({ found: false, message: 'Product not found in Open Food Facts.' });
    return res.json({ found: true, product });
  } catch (error) {
    console.error('Open Food Facts lookup failed:', error);
    return res.status(502).json({
      found: false,
      error: 'Could not reach the product database right now. You can still add the product manually.'
    });
  }
});

const recipeSchema = {
  type: 'object',
  properties: {
    recipes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          time_minutes: { type: 'integer' },
          difficulty: { type: 'string', enum: ['Easy', 'Medium', 'Hard'] },
          ingredients: { type: 'array', items: { type: 'string' } },
          steps: { type: 'array', items: { type: 'string' } },
          uses_products: { type: 'array', items: { type: 'string' } },
          priority_reason: { type: 'string' }
        },
        required: ['title', 'description', 'time_minutes', 'difficulty', 'ingredients', 'steps', 'uses_products', 'priority_reason']
      }
    },
    kitchen_note: { type: 'string' }
  },
  required: ['recipes', 'kitchen_note']
};

function sanitizeProducts(products) {
  if (!Array.isArray(products)) return [];
  return products
    .slice(0, 60)
    .map((product) => ({
      name: cleanString(product?.name, 120),
      brand: cleanString(product?.brand, 80),
      category: cleanString(product?.category, 50),
      expirationDate: cleanString(product?.expirationDate, 20),
      openedDate: cleanString(product?.openedDate, 20),
      afterOpening: Number.isFinite(Number(product?.afterOpening)) ? Number(product.afterOpening) : null,
      storage: cleanString(product?.storage, 80)
    }))
    .filter((product) => product.name);
}

function parseGeminiJson(text) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('Gemini returned an empty response.');
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Gemini returned text that could not be converted to recipe JSON.');
    return JSON.parse(match[0]);
  }
}

function normalizeRecipeResponse(data) {
  const recipes = Array.isArray(data?.recipes) ? data.recipes.slice(0, 5) : [];
  return {
    recipes: recipes.map((recipe) => ({
      title: cleanString(recipe?.title, 120) || 'Shelﬂy Recipe',
      description: cleanString(recipe?.description, 300),
      time_minutes: Math.max(1, Math.min(240, Number(recipe?.time_minutes) || 15)),
      difficulty: ['Easy', 'Medium', 'Hard'].includes(recipe?.difficulty) ? recipe.difficulty : 'Easy',
      ingredients: Array.isArray(recipe?.ingredients) ? recipe.ingredients.slice(0, 12).map((x) => cleanString(x, 160)) : [],
      steps: Array.isArray(recipe?.steps) ? recipe.steps.slice(0, 10).map((x) => cleanString(x, 240)) : [],
      uses_products: Array.isArray(recipe?.uses_products) ? recipe.uses_products.slice(0, 12).map((x) => cleanString(x, 120)) : [],
      priority_reason: cleanString(recipe?.priority_reason, 300)
    })),
    kitchen_note: cleanString(data?.kitchen_note, 500) || 'Recipes were generated from your current Shelﬂy inventory.'
  };
}

app.post('/api/recipes', async (req, res) => {
  if (!gemini) {
    return res.status(503).json({
      error: 'Gemini AI is not configured. Add GEMINI_API_KEY to the .env file and restart Shelﬂy.'
    });
  }

  const products = sanitizeProducts(req.body?.products);
  if (!products.length) {
    return res.status(400).json({ error: 'Add at least one food to My Food before asking Gemini for recipes.' });
  }

  const inventoryJson = JSON.stringify(products, null, 2);
  const today = new Date().toISOString().slice(0, 10);

  const prompt = [
    `You are Shelly, the AI recipe assistant inside the Shelﬂy food inventory app.`,
    `Today is ${today}.`,
    `The user wants practical home recipes made from the food currently registered in their kitchen.`,
    `Prioritize foods with the nearest valid expiration dates because Shelﬂy is designed to reduce food waste.`,
    `NEVER recommend a product whose expiration date is already in the past.`,
    `Respect package storage/use instructions and food-safety practices.`,
    `Use common pantry basics such as salt, pepper, cooking oil, and water only when reasonable; do not invent specialty ingredients that are not in the inventory.`,
    `Return up to five recipes. Return fewer when the inventory does not support five distinct, sensible recipes.`,
    `Write all user-facing recipe text in English.`,
    `For priority_reason, explicitly say which near-expiration product makes the recipe useful now.`,
    `Here is the current Shelﬂy inventory:`,
    inventoryJson
  ].join('\n');

  try {
    const interaction = await gemini.interactions.create({
      model: GEMINI_MODEL,
      input: prompt,
      response_format: [
        {
          type: 'text',
          mime_type: 'application/json',
          schema: recipeSchema
        }
      ]
    });

    const parsed = normalizeRecipeResponse(parseGeminiJson(interaction.output_text));
    if (!parsed.recipes.length) {
      return res.status(502).json({ error: 'Gemini could not create a recipe from the current inventory.' });
    }

    return res.json(parsed);
  } catch (error) {
    console.error('Gemini recipe generation failed:', error);
    return res.status(502).json({
      error: error?.message || 'Gemini recipe generation failed.',
      status: error?.status || null,
      code: error?.code || null,
      type: error?.name || null,
      model: GEMINI_MODEL
    });
  }
});

app.get(/^\/(?!api).*/, (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: 'Unexpected server error.' });
});

app.listen(PORT, () => {
  console.log(`Shelfly running at http://localhost:${PORT}`);
  console.log(`AI configured: ${Boolean(gemini)} | provider: Google Gemini | model: ${GEMINI_MODEL}`);
});
