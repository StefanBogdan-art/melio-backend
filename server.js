const express = require("express");
const cors = require("cors");
const multer = require("multer");
const Anthropic = require("@anthropic-ai/sdk");
const https = require("https");

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── CORS ──────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// ── SECURITATE: Secret header ─────────────────────────────
const APP_SECRET = process.env.APP_SECRET || "melio-secret-2026";

function appAuthCheck(req, res, next) {
  const secret = req.headers["x-melio-key"] || req.body?.app_key;
  if (secret !== APP_SECRET) {
    return res.status(403).json({ error: "Acces interzis." });
  }
  next();
}

// ── SECURITATE: Rate limiting ─────────────────────────────
const requestCounts = {};
const RATE_LIMIT = 30;
const RATE_WINDOW = 60 * 60 * 1000;

function rateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || "unknown";
  const now = Date.now();
  if (!requestCounts[ip]) {
    requestCounts[ip] = { count: 1, resetAt: now + RATE_WINDOW };
    return next();
  }
  if (now > requestCounts[ip].resetAt) {
    requestCounts[ip] = { count: 1, resetAt: now + RATE_WINDOW };
    return next();
  }
  if (requestCounts[ip].count >= RATE_LIMIT) {
    return res.status(429).json({ error: "Prea multe cereri. Încearcă mai târziu." });
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

// ── GET /api/health ───────────────────────────────────────
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    key: process.env.ANTHROPIC_API_KEY ? "configured" : "MISSING",
    time: new Date().toISOString()
  });
});

// ── POST /api/analizeaza-bon ──────────────────────────────
app.post("/api/analizeaza-bon", rateLimit, upload.single("bon"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Nicio imagine trimisă." });

    let mediaType = req.file.mimetype || "image/jpeg";
    const isPDF = mediaType === "application/pdf";
    const base64Data = req.file.buffer.toString("base64");
    
    // Normalizeaza media type - galeria poate trimite octet-stream
    if (!isPDF) {
      if (mediaType === "application/octet-stream" || !mediaType.startsWith("image/")) {
        mediaType = "image/jpeg";
      }
      // Accepta doar tipurile suportate de Claude
      const supported = ["image/jpeg", "image/png", "image/gif", "image/webp"];
      if (!supported.includes(mediaType)) mediaType = "image/jpeg";
    }

    const promptText = `Ești expert în citirea bonurilor de casă românești.
Analizează cu ATENȚIE MAXIMĂ acest bon și extrage TOATE produsele alimentare.

REGULI STRICTE:
1. Citește FIECARE linie din bon cu atenție
2. Extrage DOAR alimentele (mâncare, băuturi, ingrediente)
3. IGNORĂ complet: detergenți, săpun, șampon, pungi, hârtie igienică, cosmetice, ciment, cuie
4. Scrie clar în română, corectează abrevierile (PM_Faina=Făină etc)
5. Include și produsele cu reducere - sunt tot alimente
6. Dacă un produs apare de mai multe ori, include-l O SINGURĂ DATĂ

Răspunde DOAR cu JSON valid, fără text adițional:
{"ingrediente": ["produs1", "produs2", ...]}`;

    let messageContent;

    // Intotdeauna trimite ca imagine - mai compatibil
    // PDF-urile sunt convertite vizual de Claude daca sunt trimise ca document
    if (isPDF) {
      messageContent = [
        {
          type: "document", 
          source: { type: "base64", media_type: "application/pdf", data: base64Data }
        },
        { type: "text", text: promptText }
      ];
    } else {
      messageContent = [
        {
          type: "image",
          source: { type: "base64", media_type: mediaType, data: base64Data }
        },
        { type: "text", text: promptText }
      ];
    }

    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 800,
      messages: [{ role: "user", content: messageContent }]
    });

    const text = message.content.map(b => b.text || "").join("");
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
    res.json(parsed);
  } catch (err) {
    console.error("❌ /api/analizeaza-bon:", err.message, err.status, JSON.stringify(err.error || {}));
    res.status(500).json({ 
      error: err.message,
      details: err.error?.message || null
    });
  }
});

// ── POST /api/retete ──────────────────────────────────────
app.post("/api/retete", rateLimit, async (req, res) => {
  try {
    const { ingrediente, prompt_override } = req.body;
    if (!ingrediente || !ingrediente.length)
      return res.status(400).json({ error: "Lista ingrediente lipsă." });

    const prompt = prompt_override || `Ești chef culinar român. Utilizatorul are: ${ingrediente.join(", ")}.
Generează 10 rețete REALE care folosesc aceste ingrediente logic (nu combina lapte cu ceapă aiurea).
Corectează greșelile de scriere din lista de ingrediente.

Răspunde DOAR cu JSON valid:
{
  "ingrediente_corectate": [{"original": "...", "corectat": "...", "emoji": "🥕"}],
  "retete": [
    {
      "nume": "Nume rețetă",
      "timp": "30 min",
      "dificultate": "Ușor",
      "calorii": 350,
      "proteine": 20,
      "carbohidrati": 30,
      "grasimi": 15,
      "ingrediente_folosite": ["ing1", "ing2"],
      "ingrediente_complete": ["ing1 - cantitate", "ing2 - cantitate"],
      "pasi": ["Pasul 1...", "Pasul 2..."]
    }
  ]
}`;

    const message = await Promise.race([
      client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 3000,
        messages: [{ role: "user", content: prompt }]
      }),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error("Server timeout dupa 75 secunde")), 75000)
      )
    ]);

    const text = message.content.map(b => b.text || "").join("");
    console.log("Raw response length:", text.length);
    
    let parsed;
    try {
      // Curata textul si parseaza JSON
      let clean = text.replace(/```json/g, "").replace(/```/g, "").trim();
      // Gaseste primul { si ultimul }
      const start = clean.indexOf('{');
      const end = clean.lastIndexOf('}');
      if (start === -1 || end === -1) throw new Error("Nu s-a gasit JSON in raspuns");
      clean = clean.substring(start, end + 1);
      parsed = JSON.parse(clean);
    } catch(parseErr) {
      console.error("❌ JSON parse error:", parseErr.message);
      console.error("Text primit:", text.substring(0, 500));
      return res.status(500).json({ error: "Eroare procesare raspuns AI: " + parseErr.message });
    }
    
    if (!parsed.retete || !parsed.retete.length) {
      return res.status(500).json({ error: "Nu s-au generat retete" });
    }
    
    res.json(parsed);
  } catch (err) {
    console.error("❌ /api/retete:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/citeste-expirare ────────────────────────────
app.post("/api/citeste-expirare", rateLimit, async (req, res) => {
  try {
    const { produs } = req.body;
    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 200,
      messages: [{
        role: "user",
        content: `Câte zile rezistă "${produs}" în frigider după deschidere? Răspunde DOAR cu numărul de zile (ex: 7).`
      }]
    });
    const zile = parseInt(message.content[0].text.trim()) || 7;
    res.json({ zile });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── KEEP ALIVE ────────────────────────────────────────────
const RENDER_URL = process.env.RENDER_EXTERNAL_URL || "";
if (RENDER_URL) {
  setInterval(() => {
    https.get(RENDER_URL + "/api/health", (r) => {
      console.log("Keep-alive:", r.statusCode);
    }).on("error", (e) => console.log("Keep-alive err:", e.message));
  }, 14 * 60 * 1000);
}

// ── START ─────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ Melio API pornit pe http://localhost:${PORT}`);
  console.log(`   Anthropic key: ${process.env.ANTHROPIC_API_KEY ? "✓ configurată" : "✗ LIPSĂ"}`);
  console.log(`   Endpoints disponibile:`);
  console.log(`   GET  /api/health`);
  console.log(`   POST /api/retete`);
  console.log(`   POST /api/analizeaza-bon`);
  console.log(`   POST /api/citeste-expirare`);
});
