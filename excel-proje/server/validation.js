// server/validation.js - Veri Doğrulama Sistemi

// Validation rule types
const VALIDATION_TYPES = {
  REQUIRED: 'required',
  EMAIL: 'email',
  PHONE: 'phone',
  URL: 'url',
  MIN_LENGTH: 'min_length',
  MAX_LENGTH: 'max_length',
  MIN_VALUE: 'min_value',
  MAX_VALUE: 'max_value',
  REGEX: 'regex',
  UNIQUE: 'unique',
  DATE_RANGE: 'date_range',
  ENUM: 'enum'
};

// Validation functions
const validators = {
  required: (value) => {
    return value !== null && value !== undefined && value !== '';
  },

  email: (value) => {
    if (!value) return true; // Skip if empty (use required for mandatory)
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(String(value));
  },

  phone: (value) => {
    if (!value) return true;
    const phoneRegex = /^[\+]?[0-9\s\-\(\)]{10,}$/;
    return phoneRegex.test(String(value));
  },

  url: (value) => {
    if (!value) return true;
    try {
      new URL(String(value));
      return true;
    } catch {
      return false;
    }
  },

  min_length: (value, min) => {
    if (!value) return true;
    return String(value).length >= min;
  },

  max_length: (value, max) => {
    if (!value) return true;
    return String(value).length <= max;
  },

  min_value: (value, min) => {
    if (!value) return true;
    const num = parseFloat(value);
    return !isNaN(num) && num >= min;
  },

  max_value: (value, max) => {
    if (!value) return true;
    const num = parseFloat(value);
    return !isNaN(num) && num <= max;
  },

  regex: (value, pattern) => {
    if (!value) return true;
    try {
      const regex = new RegExp(pattern);
      return regex.test(String(value));
    } catch {
      return false;
    }
  },

  date_range: (value, { min_date, max_date }) => {
    if (!value) return true;
    const date = new Date(value);
    if (isNaN(date.getTime())) return false;
    
    if (min_date) {
      const min = new Date(min_date);
      if (date < min) return false;
    }
    
    if (max_date) {
      const max = new Date(max_date);
      if (date > max) return false;
    }
    
    return true;
  },

  enum: (value, allowed_values) => {
    if (!value) return true;
    return allowed_values.includes(String(value));
  }
};

// Main validation function
function validateRow(row, rules) {
  const errors = [];
  const warnings = [];

  for (const [columnName, columnRules] of Object.entries(rules)) {
    const value = row[columnName];
    
    for (const rule of columnRules) {
      const { type, params = {}, message, severity = 'error' } = rule;
      
      if (!validators[type]) {
        console.warn(`Unknown validation type: ${type}`);
        continue;
      }

      const isValid = validators[type](value, params);
      
      if (!isValid) {
        const error = {
          column: columnName,
          value: value,
          rule: type,
          message: message || `Validation failed for ${columnName}: ${type}`,
          severity: severity
        };
        
        if (severity === 'error') {
          errors.push(error);
        } else {
          warnings.push(error);
        }
      }
    }
  }

  return { errors, warnings };
}

// Validate entire dataset
function validateDataset(rows, rules) {
  const results = {
    totalRows: rows.length,
    validRows: 0,
    invalidRows: 0,
    totalErrors: 0,
    totalWarnings: 0,
    errors: [],
    warnings: [],
    summary: {}
  };

  // Initialize summary
  for (const columnName of Object.keys(rules)) {
    results.summary[columnName] = {
      errors: 0,
      warnings: 0,
      invalidRows: 0
    };
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowValidation = validateRow(row, rules);
    
    if (rowValidation.errors.length === 0) {
      results.validRows++;
    } else {
      results.invalidRows++;
    }

    // Add row index to errors/warnings
    rowValidation.errors.forEach(error => {
      error.rowIndex = i + 1;
      results.errors.push(error);
      results.totalErrors++;
      results.summary[error.column].errors++;
      results.summary[error.column].invalidRows++;
    });

    rowValidation.warnings.forEach(warning => {
      warning.rowIndex = i + 1;
      results.warnings.push(warning);
      results.totalWarnings++;
      results.summary[warning.column].warnings++;
    });
  }

  return results;
}

// Generate validation rules from column analysis
function generateValidationRules(analysis) {
  const rules = {};

  for (const [columnName, columnAnalysis] of Object.entries(analysis)) {
    const columnRules = [];

    // Required rule for columns with low null percentage
    if (columnAnalysis.nullPercentage < 20) {
      columnRules.push({
        type: 'required',
        message: `${columnName} is required`
      });
    }

    // Type-specific rules
    switch (columnAnalysis.type) {
      case 'email':
        columnRules.push({
          type: 'email',
          message: `${columnName} must be a valid email address`
        });
        break;

      case 'number':
        // Add numeric validation if sample values suggest it
        const sampleNumbers = columnAnalysis.sampleValues
          .map(v => parseFloat(v))
          .filter(n => !isNaN(n));
        
        if (sampleNumbers.length > 0) {
          const min = Math.min(...sampleNumbers);
          const max = Math.max(...sampleNumbers);
          
          if (min !== max) {
            columnRules.push({
              type: 'min_value',
              params: min,
              message: `${columnName} must be at least ${min}`
            });
            
            columnRules.push({
              type: 'max_value',
              params: max,
              message: `${columnName} must be at most ${max}`
            });
          }
        }
        break;

      case 'date':
        columnRules.push({
          type: 'date_range',
          params: {
            min_date: '1900-01-01',
            max_date: '2100-12-31'
          },
          message: `${columnName} must be a valid date`
        });
        break;
    }

    // Length validation for string columns
    if (columnAnalysis.type === 'string') {
      const maxLength = Math.max(...columnAnalysis.sampleValues.map(v => v.length));
      
      if (maxLength > 0) {
        columnRules.push({
          type: 'max_length',
          params: maxLength * 2, // Allow some flexibility
          message: `${columnName} must not exceed ${maxLength * 2} characters`
        });
      }
    }

    if (columnRules.length > 0) {
      rules[columnName] = columnRules;
    }
  }

  return rules;
}

// Clean data based on validation results
function cleanData(rows, validationResults, options = {}) {
  const {
    removeInvalidRows = false,
    fixCommonIssues = true,
    defaultValues = {}
  } = options;

  const cleanedRows = [];
  const cleaningLog = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowErrors = validationResults.errors.filter(e => e.rowIndex === i + 1);
    
    if (removeInvalidRows && rowErrors.length > 0) {
      cleaningLog.push({
        action: 'removed',
        rowIndex: i + 1,
        reason: `${rowErrors.length} validation errors`
      });
      continue;
    }

    const cleanedRow = { ...row };

    // Apply fixes
    if (fixCommonIssues) {
      for (const [columnName, value] of Object.entries(cleanedRow)) {
        let newValue = value;

        // Trim whitespace
        if (typeof newValue === 'string') {
          const trimmed = newValue.trim();
          if (trimmed !== newValue) {
            newValue = trimmed;
            cleaningLog.push({
              action: 'trimmed',
              rowIndex: i + 1,
              column: columnName,
              oldValue: value,
              newValue: newValue
            });
          }
        }

        // Apply default values for empty fields
        if ((newValue === null || newValue === undefined || newValue === '') && defaultValues[columnName]) {
          newValue = defaultValues[columnName];
          cleaningLog.push({
            action: 'default_value',
            rowIndex: i + 1,
            column: columnName,
            oldValue: value,
            newValue: newValue
          });
        }

        cleanedRow[columnName] = newValue;
      }
    }

    cleanedRows.push(cleanedRow);
  }

  return {
    cleanedRows,
    cleaningLog,
    originalCount: rows.length,
    cleanedCount: cleanedRows.length,
    removedCount: rows.length - cleanedRows.length
  };
}

module.exports = {
  VALIDATION_TYPES,
  validators,
  validateRow,
  validateDataset,
  generateValidationRules,
  cleanData
};

