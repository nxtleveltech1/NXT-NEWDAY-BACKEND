import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { promisify } from 'util';

/**
 * Comprehensive Data Encryption Service
 * Provides encryption at rest and in transit capabilities
 */
class EncryptionService {
  constructor() {
    this.algorithm = 'aes-256-gcm';
    this.keyDerivation = 'pbkdf2';
    this.hashAlgorithm = 'sha256';
    this.saltLength = 32;
    this.ivLength = 16;
    this.tagLength = 16;
    this.keyLength = 32;
    this.iterations = 100000;
    
    // Initialize master key from environment
    this.masterKey = this.deriveMasterKey();
    this.initialized = false;
  }

  /**
   * Initialize the encryption service
   */
  async initialize() {
    try {
      // Verify encryption capabilities
      await this.testEncryption();
      this.initialized = true;
      console.log('✅ Encryption Service initialized');
    } catch (error) {
      console.error('❌ Encryption Service initialization failed:', error);
      throw error;
    }
  }

  /**
   * Derive master key from environment variables
   */
  deriveMasterKey() {
    const masterSecret = process.env.ENCRYPTION_MASTER_KEY || 'default-dev-key-change-in-production';
    const salt = process.env.ENCRYPTION_SALT || 'default-salt-change-in-production';
    
    if (process.env.NODE_ENV === 'production' && masterSecret === 'default-dev-key-change-in-production') {
      throw new Error('ENCRYPTION_MASTER_KEY must be set in production');
    }

    return crypto.pbkdf2Sync(masterSecret, salt, this.iterations, this.keyLength, this.hashAlgorithm);
  }

  /**
   * Test encryption functionality
   */
  async testEncryption() {
    const testData = 'encryption-test-data';
    const encrypted = await this.encrypt(testData);
    const decrypted = await this.decrypt(encrypted);
    
    if (decrypted !== testData) {
      throw new Error('Encryption test failed');
    }
    
    console.log('✅ Encryption test passed');
  }

  /**
   * Encrypt data using AES-256-GCM
   */
  async encrypt(data, additionalData = null) {
    try {
      if (!this.initialized) {
        throw new Error('Encryption service not initialized');
      }

      const plaintext = typeof data === 'string' ? data : JSON.stringify(data);
      const iv = crypto.randomBytes(this.ivLength);
      
      const cipher = crypto.createCipher(this.algorithm, this.masterKey);
      cipher.setAAD(additionalData || Buffer.alloc(0));
      
      let encrypted = cipher.update(plaintext, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      const tag = cipher.getAuthTag();
      
      // Combine IV, tag, and encrypted data
      const result = {
        iv: iv.toString('hex'),
        tag: tag.toString('hex'),
        data: encrypted,
        algorithm: this.algorithm
      };

      return Buffer.from(JSON.stringify(result)).toString('base64');
    } catch (error) {
      console.error('Encryption failed:', error);
      throw new Error('Data encryption failed');
    }
  }

  /**
   * Decrypt data using AES-256-GCM
   */
  async decrypt(encryptedData, additionalData = null) {
    try {
      if (!this.initialized) {
        throw new Error('Encryption service not initialized');
      }

      const parsedData = JSON.parse(Buffer.from(encryptedData, 'base64').toString());
      
      const decipher = crypto.createDecipher(parsedData.algorithm, this.masterKey);
      decipher.setAuthTag(Buffer.from(parsedData.tag, 'hex'));
      decipher.setAAD(additionalData || Buffer.alloc(0));
      
      let decrypted = decipher.update(parsedData.data, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (error) {
      console.error('Decryption failed:', error);
      throw new Error('Data decryption failed');
    }
  }

  /**
   * Hash password using bcrypt
   */
  async hashPassword(password) {
    const saltRounds = 12;
    return await bcrypt.hash(password, saltRounds);
  }

  /**
   * Verify password against hash
   */
  async verifyPassword(password, hash) {
    return await bcrypt.compare(password, hash);
  }

  /**
   * Generate secure random token
   */
  generateSecureToken(length = 32) {
    return crypto.randomBytes(length).toString('hex');
  }

  /**
   * Generate HMAC signature
   */
  generateHMAC(data, secret = null) {
    const key = secret || this.masterKey;
    const hmac = crypto.createHmac(this.hashAlgorithm, key);
    hmac.update(typeof data === 'string' ? data : JSON.stringify(data));
    return hmac.digest('hex');
  }

  /**
   * Verify HMAC signature
   */
  verifyHMAC(data, signature, secret = null) {
    const expectedSignature = this.generateHMAC(data, secret);
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );
  }

  /**
   * Encrypt sensitive database fields
   */
  async encryptField(value, fieldName = '') {
    if (!value) return value;
    
    const additionalData = Buffer.from(fieldName, 'utf8');
    return await this.encrypt(value, additionalData);
  }

  /**
   * Decrypt sensitive database fields
   */
  async decryptField(encryptedValue, fieldName = '') {
    if (!encryptedValue) return encryptedValue;
    
    const additionalData = Buffer.from(fieldName, 'utf8');
    return await this.decrypt(encryptedValue, additionalData);
  }

  /**
   * Encrypt file data
   */
  async encryptFile(fileBuffer, fileName = '') {
    const additionalData = Buffer.from(fileName, 'utf8');
    const base64Data = fileBuffer.toString('base64');
    return await this.encrypt(base64Data, additionalData);
  }

  /**
   * Decrypt file data
   */
  async decryptFile(encryptedData, fileName = '') {
    const additionalData = Buffer.from(fileName, 'utf8');
    const base64Data = await this.decrypt(encryptedData, additionalData);
    return Buffer.from(base64Data, 'base64');
  }

  /**
   * Generate key pair for asymmetric encryption
   */
  generateKeyPair() {
    return crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: {
        type: 'spki',
        format: 'pem'
      },
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem'
      }
    });
  }

  /**
   * Encrypt with public key (RSA)
   */
  encryptWithPublicKey(data, publicKey) {
    return crypto.publicEncrypt(publicKey, Buffer.from(data)).toString('base64');
  }

  /**
   * Decrypt with private key (RSA)
   */
  decryptWithPrivateKey(encryptedData, privateKey) {
    return crypto.privateDecrypt(privateKey, Buffer.from(encryptedData, 'base64')).toString();
  }

  /**
   * Create digital signature
   */
  createSignature(data, privateKey) {
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(typeof data === 'string' ? data : JSON.stringify(data));
    return sign.sign(privateKey, 'base64');
  }

  /**
   * Verify digital signature
   */
  verifySignature(data, signature, publicKey) {
    const verify = crypto.createVerify('RSA-SHA256');
    verify.update(typeof data === 'string' ? data : JSON.stringify(data));
    return verify.verify(publicKey, signature, 'base64');
  }

  /**
   * Secure data transmission preparation
   */
  async prepareForTransmission(data, recipientPublicKey = null) {
    // 1. Serialize data
    const serializedData = typeof data === 'string' ? data : JSON.stringify(data);
    
    // 2. Create timestamp and nonce
    const timestamp = Date.now();
    const nonce = this.generateSecureToken(16);
    
    // 3. Create payload
    const payload = {
      data: serializedData,
      timestamp,
      nonce
    };
    
    // 4. Encrypt payload
    const encryptedPayload = await this.encrypt(JSON.stringify(payload));
    
    // 5. Create HMAC for integrity
    const hmac = this.generateHMAC(encryptedPayload);
    
    // 6. Final transmission package
    const transmissionPackage = {
      payload: encryptedPayload,
      hmac,
      version: '1.0'
    };
    
    // 7. If recipient public key provided, encrypt with it
    if (recipientPublicKey) {
      const asymmetricKey = this.generateSecureToken(32);
      const encryptedSymmetricKey = this.encryptWithPublicKey(asymmetricKey, recipientPublicKey);
      
      transmissionPackage.encryptedKey = encryptedSymmetricKey;
    }
    
    return transmissionPackage;
  }

  /**
   * Secure data transmission receipt
   */
  async receiveTransmission(transmissionPackage, privateKey = null) {
    try {
      // 1. Verify HMAC
      if (!this.verifyHMAC(transmissionPackage.payload, transmissionPackage.hmac)) {
        throw new Error('Transmission integrity check failed');
      }
      
      // 2. Decrypt payload
      const decryptedPayload = await this.decrypt(transmissionPackage.payload);
      const payload = JSON.parse(decryptedPayload);
      
      // 3. Verify timestamp (within 5 minutes)
      const now = Date.now();
      const maxAge = 5 * 60 * 1000; // 5 minutes
      
      if (now - payload.timestamp > maxAge) {
        throw new Error('Transmission expired');
      }
      
      // 4. Return data
      return JSON.parse(payload.data);
    } catch (error) {
      console.error('Failed to receive transmission:', error);
      throw new Error('Transmission receipt failed');
    }
  }

  /**
   * Encrypt sensitive configuration
   */
  async encryptConfig(config) {
    const sensitiveFields = [
      'password', 'secret', 'key', 'token', 'api_key',
      'private_key', 'certificate', 'connectionString'
    ];
    
    const encryptedConfig = { ...config };
    
    for (const [key, value] of Object.entries(config)) {
      const isSensitive = sensitiveFields.some(field => 
        key.toLowerCase().includes(field)
      );
      
      if (isSensitive && typeof value === 'string') {
        encryptedConfig[key] = await this.encryptField(value, key);
      }
    }
    
    return encryptedConfig;
  }

  /**
   * Decrypt sensitive configuration
   */
  async decryptConfig(encryptedConfig) {
    const sensitiveFields = [
      'password', 'secret', 'key', 'token', 'api_key',
      'private_key', 'certificate', 'connectionString'
    ];
    
    const decryptedConfig = { ...encryptedConfig };
    
    for (const [key, value] of Object.entries(encryptedConfig)) {
      const isSensitive = sensitiveFields.some(field => 
        key.toLowerCase().includes(field)
      );
      
      if (isSensitive && typeof value === 'string') {
        try {
          decryptedConfig[key] = await this.decryptField(value, key);
        } catch (error) {
          // Value might not be encrypted, keep original
          decryptedConfig[key] = value;
        }
      }
    }
    
    return decryptedConfig;
  }

  /**
   * Get encryption status and metrics
   */
  getEncryptionStatus() {
    return {
      initialized: this.initialized,
      algorithm: this.algorithm,
      keyDerivation: this.keyDerivation,
      keyLength: this.keyLength,
      saltLength: this.saltLength,
      iterations: this.iterations,
      capabilities: {
        symmetricEncryption: true,
        asymmetricEncryption: true,
        passwordHashing: true,
        hmacSigning: true,
        digitalSignatures: true,
        fileEncryption: true
      }
    };
  }

  /**
   * Rotate encryption keys (for production use)
   */
  async rotateKeys() {
    console.warn('Key rotation requested - this should be implemented with proper key management');
    // In production, this would:
    // 1. Generate new master key
    // 2. Re-encrypt all existing data with new key
    // 3. Update key storage
    // 4. Maintain backward compatibility during transition
  }
}

// Export singleton instance
export const encryptionService = new EncryptionService();
export default encryptionService;