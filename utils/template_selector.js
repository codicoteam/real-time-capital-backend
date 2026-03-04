const path = require('path');
const fs = require('fs');
const registry = require('../config/template_registry.json');

/**
 * Get template path and info based on application type
 * @param {string} applicationType - The template code (e.g., 'LOAN_REQUEST_FORM', 'PAWN_CONTRACT_MOTOR_VEHICLE')
 * @returns {Object} - Object with path, type, and filename
 */
function getTemplateInfo(applicationType) {
  // Get template config from registry, fallback to general_loan
  const templateConfig = registry[applicationType] || registry.general_loan;
  
  const filename = templateConfig.filename;
  const templateType = templateConfig.type || 'pdf';
  const fullPath = path.join(__dirname, '../uploads/templates/', filename);

  if (!fs.existsSync(fullPath)) {
    throw new Error(`Template not found: ${fullPath}`);
  }

  return {
    path: fullPath,
    type: templateType,
    fileName: filename
  };
}

/**
 * Get template path (legacy function for backward compatibility)
 * @param {string} applicationType - The application type or template code
 * @returns {string} - Full path to the template file
 */
function getTemplatePath(applicationType) {
  const templateInfo = getTemplateInfo(applicationType);
  return templateInfo.path;
}

module.exports = { getTemplatePath, getTemplateInfo };
