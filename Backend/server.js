const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");

dotenv.config();

const { GoogleGenAI } = require("@google/genai");

const app = express();

app.use(cors());
app.use(express.json());

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

// Temporary database.
// Later we can replace this with MongoDB.
const complaints = [];

// --------------------------------------------------
// HOME
// --------------------------------------------------

app.get("/", (req, res) => {
  res.json({
    message: "CivicTrack AI backend is running",
  });
});

// --------------------------------------------------
// ANALYZE + CREATE COMPLAINT
// --------------------------------------------------

app.post("/api/analyze-complaint", async (req, res) => {
  try {
    const { title, description, location } = req.body;

    if (!title || !description || !location) {
      return res.status(400).json({
        success: false,
        error: "Title, description and location are required.",
      });
    }

    const prompt = `
You are CivicTrack AI, an AI system for analysing civic complaints.

Analyse this complaint:

Title: ${title}
Description: ${description}
Location: ${location}

Return ONLY valid JSON in this exact structure:

{
  "category": "string",
  "department": "string",
  "priority": "LOW | MEDIUM | HIGH | CRITICAL",
  "confidence": 0,
  "slaHours": 0,
  "reason": "string"
}

Rules:

- category = type of civic issue
- department = most appropriate government department
- priority = urgency of the complaint
- confidence = number from 0 to 100
- slaHours = estimated response time in hours
- reason = short explanation
`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
    });

    const text = response.text.trim();

    const cleanedText = text
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();

    const analysis = JSON.parse(cleanedText);

    const complaintId = `CT-${Math.floor(
      1000 + Math.random() * 9000
    )}`;

    const complaint = {
      success: true,

      complaintId,

      title,
      description,
      location,

      category: analysis.category,
      department: analysis.department,
      priority: analysis.priority,
      confidence: Number(analysis.confidence),
      slaHours: Number(analysis.slaHours),
      reason: analysis.reason,

      status: "Submitted",

      submittedAt: new Date().toISOString(),

      officerAction: "No officer action recorded yet.",
    };

    // Save complaint
    complaints.unshift(complaint);

    res.json(complaint);
  } catch (error) {
  console.error("AI analysis error:", error);

  res.status(500).json({
    success: false,
    error: "Unable to analyse complaint.",
  });
}
});

// --------------------------------------------------
// GET ALL COMPLAINTS
// --------------------------------------------------

app.get("/api/complaints", (req, res) => {
  res.json({
    success: true,
    complaints,
  });
});

// --------------------------------------------------
// GET DASHBOARD STATISTICS
// --------------------------------------------------

app.get("/api/dashboard", (req, res) => {
  const total = complaints.length;

  const pending = complaints.filter(
    (complaint) =>
      complaint.status !== "Resolved"
  ).length;

  const highRisk = complaints.filter(
    (complaint) =>
      complaint.priority === "HIGH" ||
      complaint.priority === "CRITICAL"
  ).length;

  const resolved = complaints.filter(
    (complaint) =>
      complaint.status === "Resolved"
  ).length;

  res.json({
    success: true,
    statistics: {
      total,
      pending,
      highRisk,
      resolved,
    },
    complaints,
  });
});

// --------------------------------------------------
// GET ONE COMPLAINT
// --------------------------------------------------

app.get("/api/complaints/:id", (req, res) => {
  const complaint = complaints.find(
    (item) => item.complaintId === req.params.id
  );

  if (!complaint) {
    return res.status(404).json({
      success: false,
      error: "Complaint not found.",
    });
  }

  res.json({
    success: true,
    complaint,
  });
});

// --------------------------------------------------
// UPDATE COMPLAINT STATUS
// --------------------------------------------------

app.patch("/api/complaints/:id/status", (req, res) => {
  const { status, officerAction } = req.body;

  const complaint = complaints.find(
    (item) => item.complaintId === req.params.id
  );

  if (!complaint) {
    return res.status(404).json({
      success: false,
      error: "Complaint not found.",
    });
  }

  const allowedStatuses = [
    "Submitted",
    "Under Review",
    "In Progress",
    "Resolved",
  ];

  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({
      success: false,
      error: "Invalid complaint status.",
    });
  }

  complaint.status = status;

  if (officerAction) {
    complaint.officerAction = officerAction;
  }

  res.json({
    success: true,
    complaint,
  });
});

// --------------------------------------------------
// SERVER
// --------------------------------------------------

const PORT = process.env.PORT || 5000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `CivicTrack AI backend running on http://localhost:${PORT}`
  );
});