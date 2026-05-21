require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/smart-city';
mongoose.connect(MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// Define Complaint Schema
const complaintSchema = new mongoose.Schema({
  complaintId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  phone: { type: String },
  address: { type: String, required: true },
  originalText: { type: String, required: true },
  title: { type: String },
  category: { type: String },
  description: { type: String },
  priority: { type: String, default: 'Low' },
  suggestedAction: { type: String },
  status: { type: String, default: 'Pending', enum: ['Pending', 'In Progress', 'Resolved', 'Rejected'] },
  createdAt: { type: Date, default: Date.now }
});

const Complaint = mongoose.model('Complaint', complaintSchema);

// --- API Routes ---

// 1. POST /api/complaints - Save a new complaint
app.post('/api/complaints', async (req, res) => {
  try {
    const { name, phone, address, issueText } = req.body;
    
    if (!issueText) {
      return res.status(400).json({ success: false, error: 'issueText is required' });
    }

    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (!geminiApiKey) {
      return res.status(500).json({ success: false, error: 'GEMINI_API_KEY is not configured in .env' });
    }

    const prompt = `Analyze the following issue report from a citizen and extract key details. 
Return ONLY a raw JSON object with the following structure (no markdown code blocks, just the JSON string):
{
  "Title": "A short summary title",
  "Description": "A more detailed description based on the input",
  "Category": "One of: Garbage, Road, Streetlight, Water, Other",
  "Priority": "One of: Low, Medium, High",
  "SuggestedAction": "A brief recommended action for city officials"
}
Issue Report: "${issueText}"`;

    let aiResult;
    try {
      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiApiKey}`,
        {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            response_mime_type: "application/json"
          }
        }
      );
      
      const aiText = response.data.candidates[0].content.parts[0].text;
      aiResult = JSON.parse(aiText);
    } catch (apiError) {
      console.error('Gemini API Error:', apiError.response ? apiError.response.data : apiError.message);
      return res.status(500).json({ success: false, error: 'Failed to analyze issue with AI' });
    }

    const complaintId = req.body.complaintId || `SC-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`;
    
    const newComplaint = new Complaint({
      complaintId,
      name: name || 'Anonymous',
      phone,
      address: address || 'Unknown',
      originalText: issueText,
      title: aiResult.Title,
      description: aiResult.Description,
      category: aiResult.Category,
      priority: aiResult.Priority,
      suggestedAction: aiResult.SuggestedAction,
      status: 'Pending'
    });

    const savedComplaint = await newComplaint.save();
    res.status(201).json({ success: true, data: savedComplaint });

  } catch (error) {
    console.error('Error saving complaint:', error);
    res.status(500).json({ success: false, error: 'Server Error saving complaint' });
  }
});

// 2. GET /api/complaints - Get all complaints
app.get('/api/complaints', async (req, res) => {
  try {
    const complaints = await Complaint.find().sort({ createdAt: -1 });
    res.status(200).json({ success: true, count: complaints.length, data: complaints });
  } catch (error) {
    console.error('Error fetching complaints:', error);
    res.status(500).json({ success: false, error: 'Server Error fetching complaints' });
  }
});

// 3. GET /api/stats - Get statistics
app.get('/api/stats', async (req, res) => {
  try {
    const totalComplaints = await Complaint.countDocuments();
    const pendingComplaints = await Complaint.countDocuments({ status: 'Pending' });
    const inProgressComplaints = await Complaint.countDocuments({ status: 'In Progress' });
    const resolvedComplaints = await Complaint.countDocuments({ status: 'Resolved' });
    
    const categoryStats = await Complaint.aggregate([
      { $group: { _id: '$category', count: { $sum: 1 } } }
    ]);

    res.status(200).json({
      success: true,
      data: {
        total: totalComplaints,
        pending: pendingComplaints,
        inProgress: inProgressComplaints,
        resolved: resolvedComplaints,
        byCategory: categoryStats
      }
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ success: false, error: 'Server Error fetching statistics' });
  }
});

// Health check
app.get('/', (req, res) => {
  res.json({ message: 'Smart City Backend is running!', status: 'OK' });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
