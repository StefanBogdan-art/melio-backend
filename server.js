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

// ─── RATE LIMITING (30 cereri/ora/IP) ─────────────────────────────────────────
const requestCounts = {};
const RATE_LIMIT = 30;
const RATE_WINDOW = 60 * 60 * 1000; // 1 ora

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

// Curata memory la fiecare ora
setInterval(() => {
  const now = Date.now();
  Object.keys(requestCounts).forEach(ip => {
    if (now > requestCounts[ip].resetAt) delete requestCounts[ip];
  });
}, RATE_WINDOW);

// ─── CACHE RETETE (24h TTL, exact match) ──────────────────────────────────────
const retetCache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 ore

function getCacheKey(ingrediente) {
  return ingrediente.map(i => i.toLowerCase().trim()).sort().join("|");
}

// ─── HEALTH CHECK ──────────────────────────────────────────────────────────────
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ─── POST /api/retete ──────────────────────────────────────────────────────────
app.post("/api/retete", rateLimit, async (req, res) => {
  try {
    const { ingrediente, force_new } = req.body;
    if (!ingrediente || !ingrediente.length)
      return res.status(400).json({ error: "Lista ingrediente lipsă." });

    // Verificare cache (bypass daca force_new)
    const cacheKey = getCacheKey(ingrediente);
    if (!force_new && retetCache.has(cacheKey)) {
      const cached = retetCache.get(cacheKey);
      if (Date.now() < cached.expiresAt) {
        console.log("✅ Cache hit:", cacheKey.substring(0, 50));
        return res.json({ ...cached.data, fromCache: true });
      } else {
        retetCache.delete(cacheKey);
      }
    }

    const prompt = `Ești chef culinar român. Utilizatorul are aceste ingrediente disponibile: ${ingrediente.join(", ")}.

Generează 10 rețete REALE și gustoase respectând aceste reguli:
- Prioritizează combinații compatibile și logice din punct de vedere culinar
- Nu forța toate ingredientele într-o singură rețetă dacă nu se potrivesc
- Dacă unele ingrediente par incompatibile între ele (de ex. pepene cu muștar, sau fructe cu condimente savuroase), folosește-le în rețete separate, nu împreună
- Fiecare rețetă poate folosi un subset al ingredientelor disponibile + ingrediente de bază comune (sare, ulei, apă, făină)
- Corectează greșelile de scriere din lista de ingrediente
- La finalul răspunsului JSON, adaugă câmpul "sugestie_completare" cu o sugestie scurtă despre ce ingredient comun ar completa cel mai bine combinația disponibilă

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
    
    // Parser robust: gaseste primul { si ultimul }
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace === -1) throw new Error("Răspuns invalid de la AI.");
    
    const jsonText = text.substring(firstBrace, lastBrace + 1);
    const parsed = JSON.parse(jsonText);

    // Salveaza in cache
    retetCache.set(cacheKey, { data: parsed, expiresAt: Date.now() + CACHE_TTL });
    console.log("✅ /api/retete generat si cacheat:", ingrediente.length, "ingrediente");

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

    // Detectare PDF
    const isPDF =
      originalMime === "application/pdf" ||
      (originalBuffer.length > 4 &&
        originalBuffer[0] === 0x25 &&
        originalBuffer[1] === 0x50 &&
        originalBuffer[2] === 0x44 &&
        originalBuffer[3] === 0x46);

    if (isPDF) {
      // PDF — trimis ca document block catre Claude
      const base64PDF = originalBuffer.toString("base64");
      const message = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 800,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "document",
                source: { type: "base64", media_type: "application/pdf", data: base64PDF },
              },
              {
                type: "text",
                text: `Ești un asistent care analizează bonuri fiscale românești.
Citește FIECARE linie din acest bon și extrage DOAR produsele alimentare.
Ignoră: servicii, taxe, TVA, totaluri, date, ora, CIF, număr bon, produse non-alimentare (detergenți, cosmetice, haine).
Corectează abrevierile tipice de pe bonuri românești (ex: "UNT" → "unt", "PAINE" → "pâine").
Răspunde DOAR cu JSON valid:
{"produse": [{"nume": "...", "emoji": "..."}]}`,
              },
            ],
          },
        ],
      });

      const text = message.content.map(b => b.text || "").join("");
      const firstBrace = text.indexOf("{");
      const lastBrace = text.lastIndexOf("}");
      if (firstBrace === -1) throw new Error("Răspuns invalid de la AI.");
      const parsed = JSON.parse(text.substring(firstBrace, lastBrace + 1));
      return res.json(parsed);
    }

    // IMAGINE (JPEG, PNG, WEBP, HEIC, HEIF, etc.)
    // Convertim ORICE format la JPEG cu sharp — rezolva HEIC din camera si galerie
    let imageBuffer = originalBuffer;
    try {
      imageBuffer = await sharp(originalBuffer).jpeg({ quality: 85 }).toBuffer();
      console.log("✅ Sharp: imagine convertita la JPEG", originalMime, "→ image/jpeg");
    } catch (sharpErr) {
      console.warn("⚠️ Sharp conversion failed, folosesc originalul:", sharpErr.message);
      // Continua cu buffer original — nu crapa aplicatia
    }

    const base64Image = imageBuffer.toString("base64");

    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 800,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: "image/jpeg", data: base64Image },
            },
            {
              type: "text",
              text: `Ești un asistent care analizează bonuri fiscale românești.
Citește FIECARE linie din acest bon și extrage DOAR produsele alimentare.
Ignoră: servicii, taxe, TVA, totaluri, date, ora, CIF, număr bon, produse non-alimentare (detergenți, cosmetice, haine).
Corectează abrevierile tipice de pe bonuri românești (ex: "UNT" → "unt", "PAINE" → "pâine").
Răspunde DOAR cu JSON valid:
{"produse": [{"nume": "...", "emoji": "..."}]}`,
            },
          ],
        },
      ],
    });

    const text = message.content.map(b => b.text || "").join("");
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace === -1) throw new Error("Răspuns invalid de la AI.");
    const parsed = JSON.parse(text.substring(firstBrace, lastBrace + 1));

    console.log("✅ /api/analizeaza-bon:", parsed.produse?.length || 0, "produse extrase");
    res.json(parsed);
  } catch (err) {
    console.error("❌ /api/analizeaza-bon:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── KEEP-ALIVE (evita adormirea pe Render) ───────────────────────────────────
const BACKEND_URL = process.env.RENDER_EXTERNAL_URL || "https://melio-backend.onrender.com";
setInterval(async () => {
  try {
    const https = require("https");
    https.get(`${BACKEND_URL}/api/health`, res => {
      console.log("🏓 Keep-alive ping:", res.statusCode);
    }).on("error", err => {
      console.warn("⚠️ Keep-alive failed:", err.message);
    });
  } catch (e) {}
}, 14 * 60 * 1000); // la 14 minute

// ─── START ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Melio backend pornit pe portul ${PORT}`);
  console.log(`📦 Cache retete: activ (24h TTL)`);
  console.log(`🛡️  Rate limit: ${RATE_LIMIT} cereri/ora/IP`);
  console.log(`🖼️  Sharp: conversie automata HEIC/HEIF → JPEG activa`);
});
