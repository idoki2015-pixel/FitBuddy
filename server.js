import express from "express";
import multer from "multer";
import OpenAI from "openai";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = process.env.PORT || 3000;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.mimetype)) {
      return cb(new Error("unsupported_image_type"));
    }
    cb(null, true);
  }
});

app.use("/server", (_req, res) => res.sendStatus(404));
app.use(express.static(path.resolve(__dirname, ".."), { dotfiles: "deny" }));

app.post("/api/analyze-meal", upload.single("photo"), async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(503).json({ error: "service_not_configured" });
    }
    const description = String(req.body.description || "").slice(0, 500);
    if (!req.file && !description.trim()) {
      return res.status(400).json({ error: "photo_or_description_required" });
    }

    const languageNames = {
      he: "Hebrew", en: "English", ru: "Russian", ar: "Arabic"
    };
    const language = languageNames[req.body.language] || "Hebrew";
    const dataUrl = req.file
      ? `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`
      : null;
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const response = await client.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5.5",
      instructions: [
        "You are a careful food-image recognition assistant for a general wellness app.",
        `Respond in ${language}.`,
        "Identify only foods and ingredients that are reasonably visible. Do not guess exact quantities, recipes, brands, or hidden ingredients.",
        "If the image is unclear or not food, say so clearly and return empty arrays where appropriate.",
        "Provide general food education only: possible protein sources, carbohydrate sources, possible vitamins/minerals, and neutral benefits.",
        "Never provide calorie counts, energy values, portion targets, weight-loss advice, diet plans, or restrictive eating advice.",
        "Do not judge the meal as good/bad or healthy/unhealthy. Avoid medical claims.",
        "Return only valid JSON with exactly these keys: foods, ingredients, protein_sources, carbohydrate_sources, vitamins_minerals, benefits, uncertainty_note.",
        "Each key except uncertainty_note must be an array of short strings. uncertainty_note must be a short string."
      ].join(" "),
      input: [{
        role: "user",
        content: [
          { type: "input_text", text: req.file
              ? `Please analyze this food photo. Optional user description: ${description || "none"}`
              : `Please provide general food information based only on this user description (there is no photo): ${description}` },
          ...(dataUrl ? [{ type: "input_image", image_url: dataUrl, detail: "high" }] : [])
        ]
      }]
    });

    let analysis;
    try {
      const output = response.output_text || "";
      const jsonText = output.match(/\{[\s\S]*\}/)?.[0];
      if (!jsonText) throw new Error("no_json");
      analysis = JSON.parse(jsonText);
    } catch {
      return res.status(502).json({ error: "analysis_format_error" });
    }
    return res.json({ analysis });
  } catch (error) {
    console.error("Meal analysis error:", error?.message || error);
    if (error?.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "image_too_large" });
    }
    return res.status(500).json({ error: "analysis_failed" });
  }
});

app.use((err, _req, res, _next) => {
  if (err?.message === "unsupported_image_type") {
    return res.status(415).json({ error: "unsupported_image_type" });
  }
  console.error(err?.message || err);
  res.status(400).json({ error: "invalid_upload" });
});

app.listen(port, () => {
  console.log(`FitBuddy server running at http://localhost:${port}`);
});
