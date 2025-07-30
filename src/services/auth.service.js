import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';

// Simple JWT-based auth service for Node.js backend
class AuthService {
  constructor() {
    this.jwtSecret = process.env.JWT_SECRET || 'fallback-secret-key';
  }

  // Generate JWT token
  generateToken(userId) {
    return jwt.sign({ userId }, this.jwtSecret, { expiresIn: '7d' });
  }

  // Verify JWT token
  verifyToken(token) {
    try {
      return jwt.verify(token, this.jwtSecret);
    } catch (error) {
      throw new Error('Invalid token');
    }
  }

  // Hash password
  async hashPassword(password) {
    return await bcrypt.hash(password, 10);
  }

  // Compare password
  async comparePassword(password, hashedPassword) {
    return await bcrypt.compare(password, hashedPassword);
  }
}

const auth = new AuthService();

export default auth;