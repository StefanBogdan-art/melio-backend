const express = require("express");
const cors = require("cors");
const Anthropic = require("@anthropic-ai/sdk");
const multer = require("multer");
require("dotenv").config();

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.use(cors());
app.use(express.json({ limit: "10mb" }));

// ─── Health check ──────────────────────────────────────────────────────────────
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", time: new Date(), key: process.env.ANTHROPIC_API_KEY ? "configured" : "MISSING" });
});

// ─── POST /api/retete ──────────────────────────────────────────────────────────
// Primeste ingrediente, returneaza retete reale generate de AI
app.post("/api/retete", async (req, res) => {
  try {
    const { ingrediente } = req.body;
    if (!ingrediente || !ingrediente.length)
      return res.status(400).json({ error: "Lista ingrediente lipsă." });

    const prompt = `Ești chef culinar român profesionist. Utilizatorul are aceste ingrediente:
${ingrediente.map((x, i) => `${i + 1}. ${x}`).join("\n")}

REGULI OBLIGATORII:
1. Fiecare rețetă TREBUIE să folosească CEL PUȚIN UN ingredient din lista de mai sus
2. NU combina ingrediente care nu merg împreună (lapte cu ceapă = NU, lapte cu fidea = DA)
3. Dacă ai fructe (mere, prune, pere, banane) → include rețete dulci (prăjituri, compoturi)
4. Dacă ai lapte → fidea cu lapte, orez cu lapte, clătite, budincă
5. Dacă ai iaurt → tzatziki, sos, smoothie
6. Variază rețetele — nu repeta același ingredient la toate 10
7. Rețete REALE din bucătăria română și internațională
8. Corectează greșelile de scriere (ex: "prunr"→"prune", "cefa"→"ceafă de porc")

Răspunde DOAR cu JSON valid, fără markdown:
{
  "ingrediente_corectate": [
    {"original": "prunr", "corectat": "prune", "emoji": "🍑"}
  ],
  "retete": [
    {
      "nume": "Fidea cu lapte",
      "ingrediente_folosite": ["lapte"],
      "ingrediente_complete": ["200g fidea", "500ml lapte", "1 lingură zahăr", "Sare", "Vanilie"],
      "timp": "15 min",
      "dificultate": "Ușor",
      "calorii": 280,
      "proteine": 9,
      "carbohidrati": 48,
      "grasimi": 6,
      "pasi": [
        "Fierbe laptele cu un praf de sare.",
        "Adaugă fidea și gătește 8-10 min amestecând.",
        "Adaugă zahăr și vanilie.",
        "Servește cald sau rece."
      ]
    }
  ]
}
Generează exact 10 rețete variate.`;

    const message = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4000,
      messages: [{ role: "user", content: prompt }],
    });

    const text = message.content.map((b) => b.text || "").join("");
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
    res.json(parsed);
  } catch (err) {
    console.error("❌ /api/retete:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/analizeaza-bon ─────────────────────────────────────────────────
// Primeste poza bon, returneaza lista ingrediente
app.post("/api/analizeaza-bon", upload.single("bon"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Nicio imagine trimisă." });

    const imageBase64 = req.file.buffer.toString("base64");
    const mediaType = req.file.mimetype || "image/jpeg";

    const message = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 800,
      messages: [{
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: imageBase64 }
          },
          {
            type: "text",
            text: `Analizează acest bon de casă românesc.
Extrage DOAR alimentele și ingredientele (ignoră: detergenți, cosmetice, produse de curățenie, pungi, etc).
Scrie ingredientele clar în română, fără abrevieri, corectează numele.
Răspunde DOAR cu JSON valid:
{"ingrediente": ["piept de pui", "brânză telemea", "roșii cherry", ...]}`
          }
        ]
      }]
    });

    const text = message.content.map((b) => b.text || "").join("");
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
    res.json(parsed);
  } catch (err) {
    console.error("❌ /api/analizeaza-bon:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/citeste-expirare ───────────────────────────────────────────────
// Primeste poza produs, returneaza nume + data expirare
app.post("/api/citeste-expirare", upload.single("produs"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Nicio imagine trimisă." });

    const imageBase64 = req.file.buffer.toString("base64");
    const mediaType = req.file.mimetype || "image/jpeg";

    const message = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 200,
      messages: [{
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: imageBase64 }
          },
          {
            type: "text",
            text: `Extrage din această imagine:
1. Numele produsului alimentar
2. Data de expirare (format YYYY-MM-DD)
3. Categoria

Răspunde DOAR cu JSON:
{"nume": "Lapte 3.5%", "data": "2026-06-15", "categorie": "dairy|meat|veggie|fruit|bakery|other"}

Dacă nu găsești data de expirare, pune data de azi + 7 zile.
Data de azi: ${new Date().toISOString().split('T')[0]}`
          }
        ]
      }]
    });

    const text = message.content.map((b) => b.text || "").join("");
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
    res.json(parsed);
  } catch (err) {
    console.error("❌ /api/citeste-expirare:", err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n✅ Melio API pornit pe http://localhost:${PORT}`);
  console.log(`   Anthropic key: ${process.env.ANTHROPIC_API_KEY ? '✓ configurată' : '✗ LIPSĂ — pune cheia în .env'}`);
  console.log(`   Endpoints disponibile:`);
  console.log(`   GET  /api/health`);
  console.log(`   POST /api/retete`);
  console.log(`   POST /api/analizeaza-bon`);
  console.log(`   POST /api/citeste-expirare\n`);
});
