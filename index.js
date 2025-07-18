
import express from "express";
import cors from "cors";
import pkg from 'pg';
import jwt from "jsonwebtoken";
import jwksClient from "jwks-rsa";
import dotenv from "dotenv";
dotenv.config();
const { Pool } = pkg;

const app = express();
const port = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// TODO: Replace with your actual Neon connection string

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "YOUR_NEON_CONNECTION_STRING_HERE"
});

// Stack Auth JWKS setup
const projectId = process.env.VITE_STACK_PROJECT_ID;
const jwksUri = `https://api.stack-auth.com/api/v1/projects/${projectId}/.well-known/jwks.json`;
const client = jwksClient({ jwksUri });

function getKey(header, callback) {
  client.getSigningKey(header.kid, function (err, key) {
    const signingKey = key && key.getPublicKey();
    callback(null, signingKey);
  });
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.sendStatus(401);
  jwt.verify(token, getKey, { algorithms: ['RS256'] }, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
}


// Example: Protect this route with authentication
app.get("/api/products", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM products LIMIT 100");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(port, () => {
  console.log(`Horizon backend running on port ${port}`);
});
