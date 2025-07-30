#!/usr/bin/env node

import { execSync } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Test categories for the supplier module
const TEST_CATEGORIES = {
  unit: {
    name: 'Unit Tests',
    pattern: 'src/**/__tests__/*.test.js',
    threshold: 90
  },
  integration: {
    name: 'Integration Tests', 
    pattern: '__tests__/integration/*.test.js',
    threshold: 80
  },
  performance: {
    name: 'Performance Tests',
    pattern: '__tests__/performance/*.test.js',
    threshold: 70
  },
  parsers: {
    name: 'File Parser Tests',
    pattern: 'src/utils/file-parsers/__tests__/*.test.js',
    threshold: 95
  },
  routes: {
    name: 'API Route Tests',
    pattern: 'src/routes/__tests__/*.test.js',
    threshold: 90
  },
  database: {
    name: 'Database Query Tests',
    pattern: 'src/db/__tests__/*.test.js',
    threshold: 85
  }
};

// Supplier module specific files to track
const SUPPLIER_MODULE_FILES = [
  'src/services/supplier.service.js',
  'src/services/supplier-analytics.service.js',
  'src/services/supplier-search.service.js',
  'src/services/upload.service.js',
  'src/routes/supplier.routes.js',
  'src/db/supplier-queries.js',
  'src/db/price-list-queries.js',
  'src/utils/file-parsers/csv-parser.js',
  'src/utils/file-parsers/excel-parser.js',
  'src/utils/file-parsers/pdf-parser.js',
  'src/utils/file-parsers/word-parser.js',
  'src/utils/file-parsers/email-parser.js',
  'src/utils/upload-queue.js',
  'src/utils/upload-logger.js',
  'src/utils/upload-conflict-detector.js'
];

async function generateTestCoverageReport() {
  console.log('🧪 Generating Comprehensive Test Coverage Report for Supplier Module...\n');

  const report = {
    timestamp: new Date().toISOString(),
    summary: {
      totalCoverage: 0,
      categoryCoverage: {},
      fileCoverage: {},
      uncoveredFiles: []
    },
    details: {},
    recommendations: []
  };

  try {
    // Run coverage for each category
    for (const [key, category] of Object.entries(TEST_CATEGORIES)) {
      console.log(`\n📊 Running ${category.name}...`);
      
      try {
        // Run Jest with coverage for specific pattern
        const coverageCommand = `npx jest ${category.pattern} --coverage --coverageReporters=json --silent`;
        execSync(coverageCommand, { 
          cwd: path.join(__dirname, '..'),
          stdio: 'pipe' 
        });

        // Read coverage report
        const coverageFile = path.join(__dirname, '..', 'coverage', 'coverage-final.json');
        const coverageData = JSON.parse(await fs.readFile(coverageFile, 'utf8'));

        // Calculate category coverage
        let totalStatements = 0;
        let coveredStatements = 0;
        const fileCoverages = {};

        for (const [filePath, fileData] of Object.entries(coverageData)) {
          const relativePath = path.relative(path.join(__dirname, '..'), filePath);
          
          // Only include supplier module files
          if (SUPPLIER_MODULE_FILES.some(f => relativePath.includes(f))) {
            const statements = fileData.s;
            const statementCoverage = Object.values(statements);
            const covered = statementCoverage.filter(count => count > 0).length;
            const total = statementCoverage.length;

            totalStatements += total;
            coveredStatements += covered;

            const percentage = total > 0 ? (covered / total * 100).toFixed(2) : 0;
            fileCoverages[relativePath] = {
              statements: { covered, total, percentage: parseFloat(percentage) },
              lines: calculateLineCoverage(fileData),
              branches: calculateBranchCoverage(fileData),
              functions: calculateFunctionCoverage(fileData)
            };
          }
        }

        const categoryPercentage = totalStatements > 0 
          ? (coveredStatements / totalStatements * 100).toFixed(2)
          : 0;

        report.details[key] = {
          name: category.name,
          coverage: parseFloat(categoryPercentage),
          threshold: category.threshold,
          passed: parseFloat(categoryPercentage) >= category.threshold,
          files: fileCoverages
        };

        report.summary.categoryCoverage[key] = parseFloat(categoryPercentage);

        console.log(`✅ ${category.name}: ${categoryPercentage}% (Threshold: ${category.threshold}%)`);

      } catch (error) {
        console.log(`⚠️  Error running ${category.name}: ${error.message}`);
        report.details[key] = {
          name: category.name,
          error: error.message
        };
      }
    }

    // Calculate overall coverage
    const coverages = Object.values(report.summary.categoryCoverage);
    report.summary.totalCoverage = coverages.length > 0
      ? (coverages.reduce((a, b) => a + b, 0) / coverages.length).toFixed(2)
      : 0;

    // Find uncovered files
    const allCoveredFiles = new Set();
    for (const category of Object.values(report.details)) {
      if (category.files) {
        Object.keys(category.files).forEach(f => allCoveredFiles.add(f));
      }
    }

    report.summary.uncoveredFiles = SUPPLIER_MODULE_FILES.filter(
      f => !Array.from(allCoveredFiles).some(covered => covered.includes(f))
    );

    // Generate recommendations
    report.recommendations = generateRecommendations(report);

    // Generate HTML report
    await generateHTMLReport(report);

    // Generate markdown summary
    await generateMarkdownSummary(report);

    // Output summary to console
    console.log('\n' + '='.repeat(60));
    console.log('📊 SUPPLIER MODULE TEST COVERAGE SUMMARY');
    console.log('='.repeat(60));
    console.log(`Overall Coverage: ${report.summary.totalCoverage}%`);
    console.log('\nCategory Breakdown:');
    
    for (const [key, percentage] of Object.entries(report.summary.categoryCoverage)) {
      const category = TEST_CATEGORIES[key];
      const status = percentage >= category.threshold ? '✅' : '❌';
      console.log(`  ${status} ${category.name}: ${percentage}% (Target: ${category.threshold}%)`);
    }

    if (report.summary.uncoveredFiles.length > 0) {
      console.log('\n⚠️  Files without test coverage:');
      report.summary.uncoveredFiles.forEach(f => console.log(`  - ${f}`));
    }

    if (report.recommendations.length > 0) {
      console.log('\n💡 Recommendations:');
      report.recommendations.forEach((rec, i) => {
        console.log(`  ${i + 1}. ${rec}`);
      });
    }

    console.log('\n✅ Coverage reports generated:');
    console.log('  - coverage/supplier-module-report.html');
    console.log('  - coverage/supplier-module-summary.md');

  } catch (error) {
    console.error('❌ Error generating coverage report:', error);
    process.exit(1);
  }
}

function calculateLineCoverage(fileData) {
  const lines = fileData.statementMap;
  let covered = 0;
  let total = 0;

  for (const stmtId in lines) {
    total++;
    if (fileData.s[stmtId] > 0) covered++;
  }

  return {
    covered,
    total,
    percentage: total > 0 ? parseFloat((covered / total * 100).toFixed(2)) : 0
  };
}

function calculateBranchCoverage(fileData) {
  const branches = fileData.b;
  let covered = 0;
  let total = 0;

  for (const branchId in branches) {
    const branch = branches[branchId];
    total += branch.length;
    covered += branch.filter(count => count > 0).length;
  }

  return {
    covered,
    total,
    percentage: total > 0 ? parseFloat((covered / total * 100).toFixed(2)) : 0
  };
}

function calculateFunctionCoverage(fileData) {
  const functions = fileData.f;
  let covered = 0;
  let total = 0;

  for (const funcId in functions) {
    total++;
    if (functions[funcId] > 0) covered++;
  }

  return {
    covered,
    total,
    percentage: total > 0 ? parseFloat((covered / total * 100).toFixed(2)) : 0
  };
}

function generateRecommendations(report) {
  const recommendations = [];

  // Check overall coverage
  if (report.summary.totalCoverage < 90) {
    recommendations.push(
      `Increase overall test coverage from ${report.summary.totalCoverage}% to at least 90%`
    );
  }

  // Check category-specific coverage
  for (const [key, details] of Object.entries(report.details)) {
    if (details.coverage && !details.passed) {
      recommendations.push(
        `Improve ${details.name} coverage from ${details.coverage}% to ${details.threshold}%`
      );
    }
  }

  // Check for uncovered files
  if (report.summary.uncoveredFiles.length > 0) {
    recommendations.push(
      `Add tests for ${report.summary.uncoveredFiles.length} uncovered files`
    );
  }

  // Check for specific patterns
  for (const [key, details] of Object.entries(report.details)) {
    if (details.files) {
      for (const [file, coverage] of Object.entries(details.files)) {
        if (coverage.branches.percentage < 80) {
          recommendations.push(
            `Improve branch coverage for ${path.basename(file)} (currently ${coverage.branches.percentage}%)`
          );
        }
        if (coverage.functions.percentage < 90) {
          recommendations.push(
            `Add tests for untested functions in ${path.basename(file)}`
          );
        }
      }
    }
  }

  return [...new Set(recommendations)]; // Remove duplicates
}

async function generateHTMLReport(report) {
  const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Supplier Module Test Coverage Report</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
    .container { max-width: 1200px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    h1, h2, h3 { color: #333; }
    .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin: 20px 0; }
    .metric { background: #f8f9fa; padding: 20px; border-radius: 8px; text-align: center; }
    .metric h3 { margin: 0 0 10px 0; color: #666; }
    .metric .value { font-size: 36px; font-weight: bold; color: #333; }
    .metric.good .value { color: #28a745; }
    .metric.warning .value { color: #ffc107; }
    .metric.bad .value { color: #dc3545; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
    th { background: #f8f9fa; font-weight: bold; }
    tr:hover { background: #f8f9fa; }
    .coverage-bar { width: 100px; height: 20px; background: #e0e0e0; border-radius: 10px; overflow: hidden; display: inline-block; }
    .coverage-fill { height: 100%; background: #28a745; transition: width 0.3s; }
    .coverage-fill.warning { background: #ffc107; }
    .coverage-fill.danger { background: #dc3545; }
    .recommendation { background: #e3f2fd; padding: 15px; margin: 10px 0; border-radius: 4px; border-left: 4px solid #2196f3; }
    .uncovered { background: #ffebee; padding: 10px; margin: 5px 0; border-radius: 4px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🧪 Supplier Module Test Coverage Report</h1>
    <p>Generated: ${new Date(report.timestamp).toLocaleString()}</p>
    
    <div class="summary">
      <div class="metric ${report.summary.totalCoverage >= 90 ? 'good' : report.summary.totalCoverage >= 80 ? 'warning' : 'bad'}">
        <h3>Overall Coverage</h3>
        <div class="value">${report.summary.totalCoverage}%</div>
      </div>
      ${Object.entries(report.summary.categoryCoverage).map(([key, coverage]) => {
        const category = TEST_CATEGORIES[key];
        const status = coverage >= category.threshold ? 'good' : coverage >= category.threshold - 10 ? 'warning' : 'bad';
        return `
          <div class="metric ${status}">
            <h3>${category.name}</h3>
            <div class="value">${coverage}%</div>
            <small>Target: ${category.threshold}%</small>
          </div>
        `;
      }).join('')}
    </div>

    <h2>📊 Detailed Coverage by Category</h2>
    ${Object.entries(report.details).map(([key, details]) => {
      if (details.error) {
        return `<div class="uncovered"><strong>${details.name}:</strong> ${details.error}</div>`;
      }
      
      return `
        <h3>${details.name}</h3>
        <table>
          <thead>
            <tr>
              <th>File</th>
              <th>Statements</th>
              <th>Branches</th>
              <th>Functions</th>
              <th>Lines</th>
            </tr>
          </thead>
          <tbody>
            ${Object.entries(details.files || {}).map(([file, coverage]) => `
              <tr>
                <td>${path.basename(file)}</td>
                <td>
                  <div class="coverage-bar">
                    <div class="coverage-fill ${getCoverageClass(coverage.statements.percentage)}" 
                         style="width: ${coverage.statements.percentage}%"></div>
                  </div>
                  ${coverage.statements.percentage}%
                </td>
                <td>
                  <div class="coverage-bar">
                    <div class="coverage-fill ${getCoverageClass(coverage.branches.percentage)}" 
                         style="width: ${coverage.branches.percentage}%"></div>
                  </div>
                  ${coverage.branches.percentage}%
                </td>
                <td>
                  <div class="coverage-bar">
                    <div class="coverage-fill ${getCoverageClass(coverage.functions.percentage)}" 
                         style="width: ${coverage.functions.percentage}%"></div>
                  </div>
                  ${coverage.functions.percentage}%
                </td>
                <td>
                  <div class="coverage-bar">
                    <div class="coverage-fill ${getCoverageClass(coverage.lines.percentage)}" 
                         style="width: ${coverage.lines.percentage}%"></div>
                  </div>
                  ${coverage.lines.percentage}%
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    }).join('')}

    ${report.summary.uncoveredFiles.length > 0 ? `
      <h2>⚠️ Files Without Test Coverage</h2>
      ${report.summary.uncoveredFiles.map(file => 
        `<div class="uncovered">${file}</div>`
      ).join('')}
    ` : ''}

    ${report.recommendations.length > 0 ? `
      <h2>💡 Recommendations</h2>
      ${report.recommendations.map(rec => 
        `<div class="recommendation">${rec}</div>`
      ).join('')}
    ` : ''}
  </div>
</body>
</html>
  `;

  await fs.writeFile(
    path.join(__dirname, '..', 'coverage', 'supplier-module-report.html'),
    html
  );
}

function getCoverageClass(percentage) {
  if (percentage >= 90) return '';
  if (percentage >= 80) return 'warning';
  return 'danger';
}

async function generateMarkdownSummary(report) {
  const markdown = `# Supplier Module Test Coverage Summary

Generated: ${new Date(report.timestamp).toLocaleString()}

## 📊 Overall Coverage: ${report.summary.totalCoverage}%

### Category Breakdown

| Category | Coverage | Target | Status |
|----------|----------|--------|--------|
${Object.entries(report.summary.categoryCoverage).map(([key, coverage]) => {
  const category = TEST_CATEGORIES[key];
  const status = coverage >= category.threshold ? '✅' : '❌';
  return `| ${category.name} | ${coverage}% | ${category.threshold}% | ${status} |`;
}).join('\n')}

### Key Metrics

- **Total Test Files**: ${Object.values(report.details).reduce((acc, d) => acc + (d.files ? Object.keys(d.files).length : 0), 0)}
- **Uncovered Files**: ${report.summary.uncoveredFiles.length}
- **Average Coverage**: ${report.summary.totalCoverage}%

${report.summary.uncoveredFiles.length > 0 ? `
### ⚠️ Files Without Coverage

${report.summary.uncoveredFiles.map(f => `- \`${f}\``).join('\n')}
` : ''}

${report.recommendations.length > 0 ? `
### 💡 Recommendations

${report.recommendations.map((rec, i) => `${i + 1}. ${rec}`).join('\n')}
` : ''}

### Test Execution Commands

\`\`\`bash
# Run all tests with coverage
npm test -- --coverage

# Run specific test categories
npm test -- src/**/__tests__/*.test.js --coverage
npm test -- __tests__/integration/*.test.js --coverage
npm test -- __tests__/performance/*.test.js

# Generate this report
npm run test:coverage:report
\`\`\`
`;

  await fs.writeFile(
    path.join(__dirname, '..', 'coverage', 'supplier-module-summary.md'),
    markdown
  );
}

// Run the report generator
generateTestCoverageReport().catch(console.error);