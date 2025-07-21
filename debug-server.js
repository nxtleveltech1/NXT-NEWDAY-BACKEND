import express from "express";
import cors from "cors";

const app = express();
const port = 4003; // Use different port for testing

// Basic CORS
app.use(cors());
app.use(express.json());

// Simple health check without any middleware
app.get('/health', (req, res) => {
  console.log('Health check hit');
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    message: 'Debug server is working'
  });
});

// Simple API endpoint without authentication
app.get('/api/test', (req, res) => {
  console.log('Test API hit');
  res.json({
    message: 'API is responding',
    timestamp: new Date().toISOString()
  });
});

app.listen(port, () => {
  console.log(`Debug server running on port ${port}`);
  console.log(`Test with: curl http://localhost:${port}/health`);
});