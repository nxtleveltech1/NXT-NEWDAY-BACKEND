// Enhanced error reporting for price list parsers
// Provides detailed, user-friendly error messages and actionable guidance

// Error severity levels
export const ERROR_SEVERITY = {
  CRITICAL: 'critical',
  ERROR: 'error',
  WARNING: 'warning',
  INFO: 'info',
  BUSINESS_SUGGESTION: 'business_suggestion'
};

// Error categories
export const ERROR_CATEGORIES = {
  FORMAT: 'format',
  VALIDATION: 'validation',
  BUSINESS_RULE: 'business_rule',
  PERFORMANCE: 'performance',
  SYSTEM: 'system'
};

// Generate comprehensive error report
export function generateErrorReport(parseResult, validationResult, options = {}) {
  const {
    includeRawData = false,
    includeFixSuggestions = true,
    generateSummary = true,
    formatForUser = true
  } = options;

  const report = {
    timestamp: new Date().toISOString(),
    uploadId: options.uploadId || generateUploadId(),
    status: determineOverallStatus(parseResult, validationResult),
    summary: generateSummary ? createErrorSummary(parseResult, validationResult) : null,
    sections: []
  };

  // Add parsing errors section
  if (parseResult && parseResult.errors && parseResult.errors.length > 0) {
    report.sections.push(createParsingErrorsSection(parseResult, includeFixSuggestions));
  }

  // Add validation errors section
  if (validationResult && validationResult.errors && validationResult.errors.length > 0) {
    report.sections.push(createValidationErrorsSection(validationResult, includeFixSuggestions));
  }

  // Add warnings section
  const allWarnings = [
    ...(parseResult?.warnings || []),
    ...(validationResult?.warnings || []),
    ...(validationResult?.businessWarnings || [])
  ];
  
  if (allWarnings.length > 0) {
    report.sections.push(createWarningsSection(allWarnings, includeFixSuggestions));
  }

  // Add performance section
  if (validationResult?.performance && validationResult.performance.length > 0) {
    report.sections.push(createPerformanceSection(validationResult.performance));
  }

  // Add recommendations section
  if (validationResult?.recommendations && validationResult.recommendations.length > 0) {
    report.sections.push(createRecommendationsSection(validationResult.recommendations));
  }

  // Add success metrics if applicable
  if (parseResult?.success && parseResult.parsedCount > 0) {
    report.sections.push(createSuccessSection(parseResult, validationResult));
  }

  // Format for user if requested
  if (formatForUser) {
    report.userFriendlyMessage = generateUserFriendlyMessage(report);
    report.actionableSteps = generateActionableSteps(report);
  }

  return report;
}

// Determine overall status
function determineOverallStatus(parseResult, validationResult) {
  const hasParsingErrors = parseResult?.errors && parseResult.errors.length > 0;
  const hasValidationErrors = validationResult?.errors && validationResult.errors.length > 0;
  const hasWarnings = (parseResult?.warnings?.length || 0) + (validationResult?.warnings?.length || 0) > 0;
  const hasData = parseResult?.parsedCount > 0;

  if (hasParsingErrors && !hasData) {
    return 'FAILED';
  } else if (hasValidationErrors) {
    return 'VALIDATION_FAILED';
  } else if (hasWarnings) {
    return 'SUCCESS_WITH_WARNINGS';
  } else if (hasData) {
    return 'SUCCESS';
  } else {
    return 'NO_DATA';
  }
}

// Create error summary
function createErrorSummary(parseResult, validationResult) {
  const summary = {
    totalItems: parseResult?.parsedCount || 0,
    totalErrors: (parseResult?.errors?.length || 0) + (validationResult?.errors?.length || 0),
    totalWarnings: (parseResult?.warnings?.length || 0) + (validationResult?.warnings?.length || 0),
    businessSuggestions: validationResult?.businessWarnings?.length || 0,
    canProceed: false,
    processingRecommendation: 'REVIEW_REQUIRED'
  };

  // Determine if processing can proceed
  if (summary.totalErrors === 0 && summary.totalItems > 0) {
    summary.canProceed = true;
    summary.processingRecommendation = summary.totalWarnings > 0 ? 'PROCEED_WITH_CAUTION' : 'PROCEED';
  } else if (summary.totalErrors > 0) {
    summary.processingRecommendation = 'FIX_ERRORS_FIRST';
  } else {
    summary.processingRecommendation = 'NO_DATA_TO_PROCESS';
  }

  return summary;
}

// Create parsing errors section
function createParsingErrorsSection(parseResult, includeFixSuggestions) {
  const section = {
    title: 'File Parsing Issues',
    type: 'parsing_errors',
    severity: ERROR_SEVERITY.ERROR,
    count: parseResult.errors.length,
    items: []
  };

  parseResult.errors.forEach((error, index) => {
    const errorItem = {
      id: `parse_error_${index + 1}`,
      row: error.row || null,
      field: error.field || null,
      message: formatErrorMessage(error.error || error.message),
      severity: ERROR_SEVERITY.ERROR,
      category: ERROR_CATEGORIES.FORMAT
    };

    if (includeFixSuggestions) {
      errorItem.fixSuggestion = generateParsingErrorSuggestion(error);
    }

    if (error.data && typeof error.data === 'object') {
      errorItem.affectedData = JSON.stringify(error.data).substring(0, 200);
    }

    section.items.push(errorItem);
  });

  return section;
}

// Create validation errors section
function createValidationErrorsSection(validationResult, includeFixSuggestions) {
  const section = {
    title: 'Data Validation Issues',
    type: 'validation_errors',
    severity: ERROR_SEVERITY.ERROR,
    count: validationResult.errors.length,
    items: []
  };

  validationResult.errors.forEach((error, index) => {
    const errorItem = {
      id: `validation_error_${index + 1}`,
      row: error.row || null,
      field: error.field || null,
      message: formatErrorMessage(error.error || error.message),
      severity: error.severity || ERROR_SEVERITY.ERROR,
      category: ERROR_CATEGORIES.VALIDATION
    };

    if (includeFixSuggestions) {
      errorItem.fixSuggestion = generateValidationErrorSuggestion(error);
    }

    if (error.affectedItems) {
      errorItem.impact = `Affects ${error.affectedItems} item(s)`;
    }

    section.items.push(errorItem);
  });

  return section;
}

// Create warnings section
function createWarningsSection(warnings, includeFixSuggestions) {
  const section = {
    title: 'Warnings and Suggestions',
    type: 'warnings',
    severity: ERROR_SEVERITY.WARNING,
    count: warnings.length,
    items: []
  };

  warnings.forEach((warning, index) => {
    const warningItem = {
      id: `warning_${index + 1}`,
      row: warning.row || null,
      field: warning.field || null,
      message: formatErrorMessage(warning.message || warning.error),
      severity: warning.severity || ERROR_SEVERITY.WARNING,
      category: determineCategoryFromWarning(warning)
    };

    if (includeFixSuggestions && warning.suggestion) {
      warningItem.suggestion = warning.suggestion;
    }

    section.items.push(warningItem);
  });

  return section;
}

// Create performance section
function createPerformanceSection(performanceIssues) {
  return {
    title: 'Performance Considerations',
    type: 'performance',
    severity: ERROR_SEVERITY.INFO,
    count: performanceIssues.length,
    items: performanceIssues.map((issue, index) => ({
      id: `perf_${index + 1}`,
      message: formatErrorMessage(issue.message || issue.error),
      severity: issue.severity || ERROR_SEVERITY.INFO,
      category: ERROR_CATEGORIES.PERFORMANCE,
      suggestion: issue.suggestion
    }))
  };
}

// Create recommendations section
function createRecommendationsSection(recommendations) {
  return {
    title: 'Recommendations',
    type: 'recommendations',
    severity: ERROR_SEVERITY.INFO,
    count: recommendations.length,
    items: recommendations.map((rec, index) => ({
      id: `rec_${index + 1}`,
      type: rec.type,
      priority: rec.priority,
      message: rec.message,
      action: rec.action,
      severity: mapPriorityToSeverity(rec.priority)
    }))
  };
}

// Create success section
function createSuccessSection(parseResult, validationResult) {
  const summary = validationResult?.summary || {};
  
  return {
    title: 'Successfully Processed Data',
    type: 'success',
    severity: ERROR_SEVERITY.INFO,
    items: [
      {
        message: `Successfully parsed ${parseResult.parsedCount} items from ${parseResult.filename || 'uploaded file'}`,
        details: {
          totalItems: summary.totalItems || parseResult.parsedCount,
          uniqueSkus: summary.uniqueSkus,
          currencies: summary.currencies?.join(', ') || 'USD',
          itemsWithTierPricing: summary.itemsWithTierPricing || 0,
          estimatedProcessingTime: summary.estimatedProcessingTime
        }
      }
    ]
  };
}

// Generate user-friendly message
function generateUserFriendlyMessage(report) {
  const summary = report.summary;
  
  if (!summary) return 'Upload processing completed.';

  switch (report.status) {
    case 'SUCCESS':
      return `✅ Great! Successfully processed ${summary.totalItems} items with no issues.`;
    
    case 'SUCCESS_WITH_WARNINGS':
      return `⚠️ Processed ${summary.totalItems} items with ${summary.totalWarnings} warning(s). Review the warnings below, but you can proceed with the upload.`;
    
    case 'VALIDATION_FAILED':
      return `❌ Found ${summary.totalErrors} error(s) that must be fixed before uploading. Please review and correct the issues below.`;
    
    case 'FAILED':
      return `❌ Failed to parse the file. Please check the file format and try again.`;
    
    case 'NO_DATA':
      return `📄 No data found in the file. Please verify the file contains valid price list information.`;
    
    default:
      return 'Upload processing completed. Please review the details below.';
  }
}

// Generate actionable steps
function generateActionableSteps(report) {
  const steps = [];
  const hasErrors = report.summary?.totalErrors > 0;
  const hasWarnings = report.summary?.totalWarnings > 0;

  if (hasErrors) {
    steps.push({
      priority: 'high',
      action: 'Fix all errors listed below',
      description: 'Errors must be resolved before the price list can be uploaded.',
      icon: '🔧'
    });
  }

  if (hasWarnings) {
    steps.push({
      priority: 'medium',
      action: 'Review warnings',
      description: 'Warnings indicate potential issues but do not prevent upload.',
      icon: '⚠️'
    });
  }

  if (!hasErrors && report.summary?.totalItems > 0) {
    steps.push({
      priority: 'low',
      action: 'Proceed with upload',
      description: 'Your price list is ready for upload.',
      icon: '✅'
    });
  }

  if (report.summary?.totalItems === 0) {
    steps.push({
      priority: 'high',
      action: 'Check file format',
      description: 'Ensure your file contains valid price list data in the correct format.',
      icon: '📋'
    });
  }

  return steps;
}

// Helper functions

function generateUploadId() {
  return 'upload_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function formatErrorMessage(message) {
  if (!message) return 'Unknown error';
  
  // Capitalize first letter and ensure proper punctuation
  const formatted = message.charAt(0).toUpperCase() + message.slice(1);
  return formatted.endsWith('.') ? formatted : formatted + '.';
}

function generateParsingErrorSuggestion(error) {
  const message = (error.error || error.message || '').toLowerCase();
  
  if (message.includes('csv')) {
    return 'Check that the file is properly formatted CSV with comma separators and headers in the first row.';
  } else if (message.includes('excel') || message.includes('xlsx')) {
    return 'Ensure the Excel file is not corrupted and contains data in the first worksheet.';
  } else if (message.includes('json')) {
    return 'Verify that the JSON file is valid and follows the expected structure.';
  } else if (message.includes('xml')) {
    return 'Check that the XML file is well-formed and contains the expected elements.';
  } else if (message.includes('pdf')) {
    return 'PDF files must contain structured tables with text (not images). Consider converting to CSV or Excel.';
  } else if (message.includes('required')) {
    return 'Ensure all required columns (SKU, Unit Price) are present and properly named.';
  } else {
    return 'Check the file format and ensure it contains valid price list data.';
  }
}

function generateValidationErrorSuggestion(error) {
  const field = error.field || '';
  const message = (error.error || error.message || '').toLowerCase();
  
  if (field === 'sku') {
    if (message.includes('required')) {
      return 'Ensure every row has a valid SKU (product identifier).';
    } else if (message.includes('duplicate')) {
      return 'Remove or consolidate duplicate SKUs. Each SKU should appear only once.';
    } else {
      return 'Use alphanumeric characters, hyphens, and underscores only for SKUs.';
    }
  } else if (field === 'unitPrice') {
    return 'Ensure all prices are positive numbers greater than 0.';
  } else if (field === 'currency') {
    return 'Use standard currency codes: USD, EUR, GBP, or ZAR.';
  } else if (field === 'tierPricing') {
    return 'Check that tier quantities are valid and tier prices are lower than unit prices.';
  } else {
    return 'Review the data format and ensure all required fields are properly filled.';
  }
}

function determineCategoryFromWarning(warning) {
  const message = (warning.message || warning.error || '').toLowerCase();
  
  if (message.includes('business') || message.includes('pricing') || message.includes('discount')) {
    return ERROR_CATEGORIES.BUSINESS_RULE;
  } else if (message.includes('performance') || message.includes('large') || message.includes('slow')) {
    return ERROR_CATEGORIES.PERFORMANCE;
  } else {
    return ERROR_CATEGORIES.VALIDATION;
  }
}

function mapPriorityToSeverity(priority) {
  switch (priority) {
    case 'high': return ERROR_SEVERITY.WARNING;
    case 'medium': return ERROR_SEVERITY.INFO;
    case 'low': return ERROR_SEVERITY.BUSINESS_SUGGESTION;
    default: return ERROR_SEVERITY.INFO;
  }
}

// Export error report as different formats
export function exportErrorReportAsJSON(report) {
  return JSON.stringify(report, null, 2);
}

export function exportErrorReportAsCSV(report) {
  const rows = [];
  
  // Add header
  rows.push(['Section', 'Type', 'Row', 'Field', 'Severity', 'Message', 'Suggestion'].join(','));
  
  // Add data from each section
  report.sections.forEach(section => {
    section.items.forEach(item => {
      rows.push([
        section.title,
        section.type,
        item.row || '',
        item.field || '',
        item.severity,
        `"${item.message.replace(/"/g, '""')}"`,
        `"${(item.fixSuggestion || item.suggestion || '').replace(/"/g, '""')}"`
      ].join(','));
    });
  });
  
  return rows.join('\\n');
}

export function exportErrorReportAsHTML(report) {
  let html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Price List Upload Report</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .summary { background: #f5f5f5; padding: 15px; border-radius: 5px; margin-bottom: 20px; }
        .section { margin-bottom: 30px; }
        .error { color: #d32f2f; }
        .warning { color: #f57c00; }
        .info { color: #1976d2; }
        .success { color: #388e3c; }
        table { width: 100%; border-collapse: collapse; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f2f2f2; }
        .message { color: #333; }
        .user-message { font-size: 18px; font-weight: bold; margin-bottom: 15px; }
      </style>
    </head>
    <body>
      <h1>Price List Upload Report</h1>
      <div class="user-message">${report.userFriendlyMessage || ''}</div>
  `;

  if (report.summary) {
    html += `
      <div class="summary">
        <h3>Summary</h3>
        <p><strong>Status:</strong> ${report.status}</p>
        <p><strong>Items Processed:</strong> ${report.summary.totalItems}</p>
        <p><strong>Errors:</strong> ${report.summary.totalErrors}</p>
        <p><strong>Warnings:</strong> ${report.summary.totalWarnings}</p>
        <p><strong>Can Proceed:</strong> ${report.summary.canProceed ? 'Yes' : 'No'}</p>
      </div>
    `;
  }

  report.sections.forEach(section => {
    html += `
      <div class="section">
        <h3 class="${section.severity}">${section.title} (${section.count})</h3>
        <table>
          <thead>
            <tr>
              <th>Row</th>
              <th>Field</th>
              <th>Message</th>
              <th>Suggestion</th>
            </tr>
          </thead>
          <tbody>
    `;
    
    section.items.forEach(item => {
      html += `
        <tr>
          <td>${item.row || '-'}</td>
          <td>${item.field || '-'}</td>
          <td class="message">${item.message}</td>
          <td>${item.fixSuggestion || item.suggestion || '-'}</td>
        </tr>
      `;
    });
    
    html += `
          </tbody>
        </table>
      </div>
    `;
  });

  html += `
    </body>
    </html>
  `;

  return html;
}