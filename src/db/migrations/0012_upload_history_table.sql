-- Upload History Table Migration
-- Tracks all supplier price list uploads with comprehensive metadata

CREATE TABLE IF NOT EXISTS upload_history (
  id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  supplierId VARCHAR(36) NOT NULL,
  uploadId VARCHAR(36) NOT NULL UNIQUE,
  fileName VARCHAR(255) NOT NULL,
  fileSize BIGINT,
  fileType VARCHAR(50),
  status ENUM('pending', 'processing', 'completed', 'failed', 'requires_approval', 'approved', 'rejected') DEFAULT 'pending',
  uploadDate TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  processedDate TIMESTAMP NULL,
  approvedDate TIMESTAMP NULL,
  approvedBy VARCHAR(36) NULL,
  
  -- Upload statistics
  totalItems INT DEFAULT 0,
  validItems INT DEFAULT 0,
  invalidItems INT DEFAULT 0,
  newItems INT DEFAULT 0,
  updatedItems INT DEFAULT 0,
  duplicateItems INT DEFAULT 0,
  
  -- Processing metadata
  processingTime DECIMAL(10,3), -- milliseconds
  priceRulesApplied BOOLEAN DEFAULT FALSE,
  estimatedValue DECIMAL(15,2),
  
  -- Validation results
  criticalErrors JSON,
  warnings JSON,
  
  -- Configuration used
  uploadOptions JSON,
  priceRulesConfig JSON,
  
  -- Additional metadata
  userAgent TEXT,
  ipAddress VARCHAR(45),
  notes TEXT,
  
  -- Audit fields
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  -- Indexes for performance
  INDEX idx_supplier_upload_date (supplierId, uploadDate DESC),
  INDEX idx_upload_status (status),
  INDEX idx_upload_id (uploadId),
  INDEX idx_processed_date (processedDate),
  
  -- Foreign key constraints
  FOREIGN KEY (supplierId) REFERENCES suppliers(id) ON DELETE CASCADE
) ENGINE=InnoDB CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Create indexes for optimal query performance
CREATE INDEX idx_upload_history_compound ON upload_history (supplierId, status, uploadDate DESC);
CREATE INDEX idx_upload_history_search ON upload_history (fileName, fileType, status);

-- Upload session tracking table for real-time progress
CREATE TABLE IF NOT EXISTS upload_sessions (
  sessionId VARCHAR(36) PRIMARY KEY,
  uploadId VARCHAR(36) NOT NULL,
  supplierId VARCHAR(36) NOT NULL,
  status VARCHAR(50) DEFAULT 'active',
  progress INT DEFAULT 0,
  currentStep VARCHAR(100),
  message TEXT,
  startTime TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  lastUpdate TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  INDEX idx_session_upload (uploadId),
  INDEX idx_session_supplier (supplierId),
  INDEX idx_session_status (status),
  
  FOREIGN KEY (supplierId) REFERENCES suppliers(id) ON DELETE CASCADE
) ENGINE=InnoDB CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Upload file preview data for approval workflow
CREATE TABLE IF NOT EXISTS upload_previews (
  id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  uploadId VARCHAR(36) NOT NULL,
  supplierId VARCHAR(36) NOT NULL,
  previewData JSON NOT NULL,
  summaryStats JSON,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expiresAt TIMESTAMP DEFAULT (DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 24 HOUR)),
  
  INDEX idx_preview_upload (uploadId),
  INDEX idx_preview_expires (expiresAt),
  
  FOREIGN KEY (supplierId) REFERENCES suppliers(id) ON DELETE CASCADE,
  FOREIGN KEY (uploadId) REFERENCES upload_history(uploadId) ON DELETE CASCADE
) ENGINE=InnoDB CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;