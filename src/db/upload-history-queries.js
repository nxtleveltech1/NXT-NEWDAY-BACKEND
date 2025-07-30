import { eq, and, sql, desc, asc } from 'drizzle-orm';
import { db } from '../config/database.js';
import { uploadHistory } from './schema.js';

// Create upload history record
export async function createUploadHistoryRecord(data) {
  const result = await db
    .insert(uploadHistory)
    .values({
      ...data,
      uploadDate: new Date()
    })
    .returning();
    
  return result[0];
}

// Update upload history status
export async function updateUploadHistoryStatus(id, status, metadata = {}) {
  const updateData = {
    status,
    ...metadata,
    updatedAt: new Date()
  };
  
  if (status === 'completed') {
    updateData.completedAt = new Date();
  } else if (status === 'failed') {
    updateData.failedAt = new Date();
  }
  
  const result = await db
    .update(uploadHistory)
    .set(updateData)
    .where(eq(uploadHistory.id, id))
    .returning();
    
  return result[0] || null;
}

// Get upload history with filters
export async function getUploadHistory(params = {}) {
  const {
    page = 1,
    limit = 10,
    supplierId = null,
    uploadedBy = null,
    status = null,
    fileType = null,
    dateFrom = null,
    dateTo = null,
    sortBy = 'uploadDate',
    sortOrder = 'desc'
  } = params;
  
  const offset = (page - 1) * limit;
  const orderBy = sortOrder === 'asc' ? asc(uploadHistory[sortBy]) : desc(uploadHistory[sortBy]);
  
  let conditions = [];
  
  if (supplierId) {
    conditions.push(eq(uploadHistory.supplierId, supplierId));
  }
  
  if (uploadedBy) {
    conditions.push(eq(uploadHistory.uploadedBy, uploadedBy));
  }
  
  if (status) {
    conditions.push(eq(uploadHistory.status, status));
  }
  
  if (fileType) {
    conditions.push(eq(uploadHistory.fileType, fileType));
  }
  
  if (dateFrom) {
    conditions.push(sql`${uploadHistory.uploadDate} >= ${new Date(dateFrom)}`);
  }
  
  if (dateTo) {
    conditions.push(sql`${uploadHistory.uploadDate} <= ${new Date(dateTo)}`);
  }
  
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  
  const [results, totalCount] = await Promise.all([
    db
      .select()
      .from(uploadHistory)
      .where(whereClause)
      .orderBy(orderBy)
      .limit(limit)
      .offset(offset),
      
    db
      .select({ count: sql`count(*)` })
      .from(uploadHistory)
      .where(whereClause)
  ]);
  
  return {
    uploads: results,
    pagination: {
      total: Number(totalCount[0].count),
      page,
      limit,
      totalPages: Math.ceil(Number(totalCount[0].count) / limit)
    }
  };
}

// Get upload history by ID
export async function getUploadHistoryById(id) {
  const result = await db
    .select()
    .from(uploadHistory)
    .where(eq(uploadHistory.id, id))
    .limit(1);
    
  return result[0] || null;
}

// Get upload statistics
export async function getUploadStatistics(params = {}) {
  const { supplierId = null, dateFrom = null, dateTo = null } = params;
  
  let conditions = [];
  
  if (supplierId) {
    conditions.push(eq(uploadHistory.supplierId, supplierId));
  }
  
  if (dateFrom) {
    conditions.push(sql`${uploadHistory.uploadDate} >= ${new Date(dateFrom)}`);
  }
  
  if (dateTo) {
    conditions.push(sql`${uploadHistory.uploadDate} <= ${new Date(dateTo)}`);
  }
  
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  
  const stats = await db
    .select({
      totalUploads: sql`count(*)`,
      successfulUploads: sql`count(*) filter (where ${uploadHistory.status} = 'completed')`,
      failedUploads: sql`count(*) filter (where ${uploadHistory.status} = 'failed')`,
      pendingUploads: sql`count(*) filter (where ${uploadHistory.status} = 'processing')`,
      totalItemsProcessed: sql`COALESCE(SUM(${uploadHistory.itemCount}), 0)`,
      averageItemsPerUpload: sql`AVG(${uploadHistory.itemCount})`,
      fileTypeBreakdown: sql`json_object_agg(${uploadHistory.fileType}, count(*))`,
      averageProcessingTime: sql`AVG(EXTRACT(epoch FROM (${uploadHistory.completedAt} - ${uploadHistory.uploadDate})))`,
      errorRate: sql`(count(*) filter (where ${uploadHistory.status} = 'failed'))::float / NULLIF(count(*), 0) * 100`
    })
    .from(uploadHistory)
    .where(whereClause);
    
  return stats[0];
}

// Get recent upload errors
export async function getRecentUploadErrors(limit = 10) {
  const errors = await db
    .select({
      id: uploadHistory.id,
      fileName: uploadHistory.fileName,
      fileType: uploadHistory.fileType,
      supplierId: uploadHistory.supplierId,
      uploadDate: uploadHistory.uploadDate,
      errors: uploadHistory.errors,
      errorCount: uploadHistory.errorCount
    })
    .from(uploadHistory)
    .where(
      and(
        eq(uploadHistory.status, 'failed'),
        sql`${uploadHistory.errorCount} > 0`
      )
    )
    .orderBy(desc(uploadHistory.uploadDate))
    .limit(limit);
    
  return errors;
}

// Clean up old upload history
export async function cleanupOldUploadHistory(daysToKeep = 90) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
  
  const result = await db
    .delete(uploadHistory)
    .where(
      and(
        sql`${uploadHistory.uploadDate} < ${cutoffDate}`,
        eq(uploadHistory.status, 'completed')
      )
    );
    
  return result;
}
