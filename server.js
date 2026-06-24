const express = require("express");
const cors = require("cors");
const Anthropic = require("@anthropic-ai/sdk");
const multer = require("multer");
const sharp = require("sharp");
require("dotenv").config();

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.use(cors());
app.use(express.json({ limit: "10mb" }));

// ─── LOGGING IP ────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  const ip = req.headers["x-forwarded-for"]?.split(",")[0] || req.socket.remoteAddress;
  console.log(`📡 ${new Date().toISOString()} | ${req.method} ${req.path} | IP: ${ip}`);
  next();
});

// ─── RATE LIMITING (30 cereri/ora/IP) ─────────────────────────────────────────
const requestCounts = {};
const RATE_LIMIT = 30;
const RATE_WINDOW = 60 * 60 * 1000;

function rateLimit(req, res, next) {
  const ip = req.headers["x-forwarded-for"]?.split(",")[0] || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  if (!requestCounts[ip] || now > requestCounts[ip].resetAt) {
    requestCounts[ip] = { count: 0, resetAt: now + RATE_WINDOW };
  }
  if (requestCounts[ip].count >= RATE_LIMIT) {
    return res.status(429).json({ error: "Prea multe cereri. Încearcă din nou mai târziu." });
  }
  requestCounts[ip].count++;
  next();
}

setInterval(() => {
  const now = Date.now();
  Object.keys(requestCounts).forEach(ip => {
    if (now > requestCounts[ip].resetAt) delete requestCounts[ip];
  });
}, RATE_WINDOW);

// ─── CACHE RETETE (7 zile TTL) ────────────────────────────────────────────────
const retetCache = new Map();
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;

function getCacheKey(ingrediente) {
  return ingrediente.map(i => i.toLowerCase().trim()).sort().join("|");
}

// ─── CONVERSIE IMAGINE (sharp + fallback heic-convert) ────────────────────────
async function convertToJpeg(buffer, originalMime) {
  // Incercam sharp mai intai
  try {
    const result = await sharp(buffer).jpeg({ quality: 85 }).toBuffer();
    console.log("✅ Sharp: convertit", originalMime, "→ JPEG");
    return result;
  } catch (sharpErr) {
    console.warn("⚠️ Sharp failed:", sharpErr.message);
  }

  // Fallback: heic-convert pentru HEIC complexe pe care sharp le refuza
  try {
    const heicConvert = require("heic-convert");
    const result = await heicConvert({
      buffer: buffer,
      format: "JPEG",
      quality: 0.85,
    });
    console.log("✅ heic-convert: HEIC convertit cu succes");
    return Buffer.from(result);
  } catch (heicErr) {
    console.warn("⚠️ heic-convert failed:", heicErr.message);
  }

  // Daca ambele au esuat, aruncam eroare clara
  throw new Error("FORMAT_NESUPORTAT");
}

// ─── HEALTH CHECK ──────────────────────────────────────────────────────────────
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ─── POST /api/retete (Sonnet - calitate maxima) ───────────────────────────────
app.post("/api/retete", rateLimit, async (req, res) => {
  try {
    const { ingrediente, force_new } = req.body;
    if (!ingrediente || !ingrediente.length)
      return res.status(400).json({ error: "Lista ingrediente lipsă." });

    const cacheKey = getCacheKey(ingrediente);
    if (!force_new && retetCache.has(cacheKey)) {
      const cached = retetCache.get(cacheKey);
      if (Date.now() < cached.expiresAt) {
        console.log("✅ Cache hit retete:", cacheKey.substring(0, 50));
        return res.json({ ...cached.data, fromCache: true });
      } else {
        retetCache.delete(cacheKey);
      }
    }

    const prompt = `Ești chef culinar român cu experiență în nutriție. Utilizatorul are aceste ingrediente disponibile: ${ingrediente.join(", ")}.

Generează 10 rețete REALE și gustoase respectând aceste reguli:
- Prioritizează combinații compatibile și logice din punct de vedere culinar
- Nu forța toate ingredientele într-o singură rețetă dacă nu se potrivesc
- Dacă unele ingrediente par incompatibile (ex: pepene cu muștar, fructe cu condimente savuroase), folosește-le în rețete separate, nu împreună
- Fiecare rețetă poate folosi un subset al ingredientelor disponibile + ingrediente de bază comune (sare, ulei, apă, făină)
- Corectează greșelile de scriere din lista de ingrediente
- Valorile nutritive (calorii, proteine, carbohidrați, grăsimi) trebuie să fie REALE și calculate corect per porție
- La final adaugă câmpul "sugestie_completare" cu ce ingredient comun ar completa cel mai bine combinația

Răspunde DOAR cu JSON valid, fără text înainte sau după:
{
  "ingrediente_corectate": [{"original":"...","corectat":"...","emoji":"..."}],
  "retete": [
    {
      "nume": "...",
      "ingrediente_folosite": ["..."],
      "ingrediente_complete": ["..."],
      "timp": "...",
      "dificultate": "Ușor",
      "calorii": 300,
      "proteine": 20,
      "carbohidrati": 30,
      "grasimi": 10,
      "pasi": ["..."]
    }
  ],
  "sugestie_completare": "Pentru a completa aceste ingrediente, ai putea adăuga ..."
}`;

    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8000,
      messages: [{ role: "user", content: prompt }],
    });

    const text = message.content.map(b => b.text || "").join("");
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace === -1) throw new Error("Răspuns invalid de la AI.");

    const parsed = JSON.parse(text.substring(firstBrace, lastBrace + 1));
    retetCache.set(cacheKey, { data: parsed, expiresAt: Date.now() + CACHE_TTL });
    console.log("✅ /api/retete generat (Sonnet):", ingrediente.length, "ingrediente, cacheat 7 zile");

    res.json(parsed);
  } catch (err) {
    console.error("❌ /api/retete:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/analizeaza-bon ──────────────────────────────────────────────────
app.post("/api/analizeaza-bon", rateLimit, upload.single("bon"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Nicio imagine trimisă." });

    const originalBuffer = req.file.buffer;
    const originalMime = req.file.mimetype;

    const PROMPT_BON = `Ești un asistent care analizează bonuri fiscale românești.
Citește FIECARE linie din acest bon și extrage DOAR produsele alimentare.
Ignoră: servicii, taxe, TVA, totaluri, date, ora, CIF, număr bon, produse non-alimentare (detergenți, cosmetice, haine).
Corectează abrevierile tipice de pe bonuri românești (ex: "UNT" → "unt", "PAINE" → "pâine").
Răspunde DOAR cu JSON valid:
{"produse": [{"nume": "...", "emoji": "..."}]}`;

    // ── PDF ──
    const isPDF =
      originalMime === "application/pdf" ||
      (originalBuffer.length > 4 &&
        originalBuffer[0] === 0x25 &&
        originalBuffer[1] === 0x50 &&
        originalBuffer[2] === 0x44 &&
        originalBuffer[3] === 0x46);

    if (isPDF) {
      const base64PDF = originalBuffer.toString("base64");
      const message = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 800,
        messages: [{
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64PDF } },
            { type: "text", text: PROMPT_BON }
          ]
        }]
      });
      const text = message.content.map(b => b.text || "").join("");
      const parsed = JSON.parse(text.substring(text.indexOf("{"), text.lastIndexOf("}") + 1));
      console.log("✅ /api/analizeaza-bon PDF (Sonnet):", parsed.produse?.length || 0, "produse");
      return res.json(parsed);
    }

    // ── IMAGINE (JPEG, PNG, HEIC, HEIF, orice format) ──
    let imageBuffer;
    try {
      imageBuffer = await convertToJpeg(originalBuffer, originalMime);
    } catch (convErr) {
      return res.status(400).json({
        error: "Format imagine nesuportat. Te rugăm să faci poza direct din cameră sau să o salvezi ca JPEG."
      });
    }

    const base64Image = imageBuffer.toString("base64");

    // Haiku pentru imagini - de ~20x mai ieftin, suficient pentru citit bon
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 800,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64Image } },
          { type: "text", text: PROMPT_BON }
        ]
      }]
    });

    const text = message.content.map(b => b.text || "").join("");
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace === -1) throw new Error("Răspuns invalid de la AI.");
    const parsed = JSON.parse(text.substring(firstBrace, lastBrace + 1));

    console.log("✅ /api/analizeaza-bon imagine (Haiku):", parsed.produse?.length || 0, "produse");
    res.json(parsed);
  } catch (err) {
    console.error("❌ /api/analizeaza-bon:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── KEEP-ALIVE (evita adormirea pe Render) ───────────────────────────────────
const BACKEND_URL = process.env.RENDER_EXTERNAL_URL || "https://melio-backend.onrender.com";
setInterval(() => {
  try {
    const https = require("https");
    https.get(`${BACKEND_URL}/api/health`, r => {
      console.log("🏓 Keep-alive:", r.statusCode);
    }).on("error", e => {
      console.warn("⚠️ Keep-alive failed:", e.message);
    });
  } catch (e) {}
}, 14 * 60 * 1000);

// ─── START ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Melio backend pornit pe portul ${PORT}`);
  console.log(`📦 Cache retete: 7 zile TTL`);
  console.log(`🛡️  Rate limit: ${RATE_LIMIT} cereri/ora/IP`);
  console.log(`🖼️  Bon imagine: Haiku + sharp + heic-convert`);
  console.log(`📄 Bon PDF: Sonnet`);
  console.log(`🍳 Retete: Sonnet (calitate maxima)`);
});
