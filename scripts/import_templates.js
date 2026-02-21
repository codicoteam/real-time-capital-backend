const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const connectDB = require('../configs/db_config');
const DocumentTemplate = require('../models/document-template.model');

dotenv.config();

// Usage: node scripts/import_templates.js "C:\\Users\\Takunda Gowa\\Desktop\\task"
const srcDir = process.argv[2] || path.join(process.env.USERPROFILE || '', 'Desktop', 'task');
const projectTemplatesDir = path.join(__dirname, '..', 'uploads', 'templates');

if (!fs.existsSync(srcDir)) {
  console.error(`Source templates folder not found: ${srcDir}`);
  process.exit(1);
}

if (!fs.existsSync(projectTemplatesDir)) {
  fs.mkdirSync(projectTemplatesDir, { recursive: true });
}

function detectTemplateCode(filename) {
  const name = filename.toLowerCase();
  if (name.includes('loan')) return 'LOAN_REQUEST_FORM';
  if (name.includes('motor')) return 'PAWN_CONTRACT_MOTOR_VEHICLE';
  if (name.includes('movable') || name.includes('movables') || name.includes('other')) return 'PAWN_CONTRACT_OTHER_MOVABLES';
  return null;
}

async function run() {
  try {
    // Connect to DB
    await connectDB();

    const files = fs.readdirSync(srcDir).filter(f => /\.(pdf|docx|doc)$/i.test(f));
    if (!files.length) {
      console.log('No template files found in source folder.');
      process.exit(0);
    }

    for (const file of files) {
      const srcPath = path.join(srcDir, file);
      const destFileName = `${Date.now()}_${file}`;
      const destPath = path.join(projectTemplatesDir, destFileName);

      fs.copyFileSync(srcPath, destPath);

      const code = detectTemplateCode(file) || file.replace(/\.[^.]+$/, '').toUpperCase().replace(/[^A-Z0-9_]/g, '_');
      const title = file.replace(/\.[^.]+$/, '');

      // Upsert DocumentTemplate
      const existing = await DocumentTemplate.findOne({ code });
      if (existing) {
        existing.title = title;
        existing.file_url = `uploads/templates/${destFileName}`;
        existing.is_active = true;
        existing.version = existing.version || 'v1';
        await existing.save();
        console.log(`Updated template: ${code} -> ${existing.file_url}`);
      } else {
        const doc = new DocumentTemplate({
          code,
          title,
          file_url: `uploads/templates/${destFileName}`,
          is_active: true,
        });
        await doc.save();
        console.log(`Created template: ${code} -> ${doc.file_url}`);
      }
    }

    console.log('Template import complete.');
    process.exit(0);
  } catch (err) {
    console.error('Error importing templates:', err);
    process.exit(1);
  }
}

run();
