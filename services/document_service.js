const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const { PDFDocument: PDFLibDocument } = require("pdf-lib");
const DocumentTemplate = require("../models/document-template.model");
const SignedDocument = require("../models/signed-document.model");
const LoanApplication = require("../models/loanApplication.model");
const Loan = require("../models/loan.model");
const Asset = require("../models/asset.model");
const mongoose = require("mongoose");
const templateSelector = require("../utils/template_selector");

// Ensure documents directory exists
const docsDir = path.join(__dirname, "../uploads/documents");
const templatesDir = path.join(__dirname, "../uploads/templates");

if (!fs.existsSync(docsDir)) {
  fs.mkdirSync(docsDir, { recursive: true });
}

class DocumentService {
  /**
   * Map template codes to actual template files (PDF or DOCX)
   * Uses the template registry for dynamic template selection
   * Returns an object with path and type (pdf or docx)
   */
  _getTemplateFilePath(templateCode) {
    try {
      // Use the template selector to get template info from registry
      const templateInfo = templateSelector.getTemplateInfo(templateCode);
      return templateInfo;
    } catch (error) {
      console.error(`Template file not found for ${templateCode}: ${error.message}`);
      return null;
    }
  }

  /**
   * Detect if base64 string is a PDF or image
   * Returns 'pdf', 'png', 'jpeg', or null if unknown
   */
  _detectSignatureFormat(base64String) {
    const base64Data = base64String.replace(/^data:[^;]+;base64,/, "");
    const firstBytes = Buffer.from(base64Data.slice(0, 8), "base64");
    
    if (firstBytes[0] === 0x25 && firstBytes[1] === 0x50 && firstBytes[2] === 0x44 && firstBytes[3] === 0x46) {
      return "pdf";
    }
    
    if (firstBytes[0] === 0x89 && firstBytes[1] === 0x50 && firstBytes[2] === 0x4E && firstBytes[3] === 0x47) {
      return "png";
    }
    
    if (firstBytes[0] === 0xFF && firstBytes[1] === 0xD8 && firstBytes[2] === 0xFF) {
      return "jpeg";
    }
    
    return null;
  }

  /**
   * Convert .docx to PDF using docx-pdf
   */
  async _convertDocxToPdf(docxPath, outputPath) {
    try {
      const docxPdf = require("docx-pdf");
      
      return new Promise((resolve, reject) => {
        docxPdf(docxPath, outputPath, function(err, result) {
          if (err) {
            reject(err);
          } else {
            resolve(result);
          }
        });
      });
    } catch (error) {
      console.error("docx-pdf conversion failed:", error.message);
      throw error;
    }
  }

/**
   * Generate PDF from .docx template with loan application data
   * Returns base64 encoded PDF
   */
  async generateDocumentFromTemplate(loanApplicationId, templateCode = "LOAN_REQUEST_FORM") {
    try {
      // Fetch loan application
      const application = await LoanApplication.findById(loanApplicationId).lean();
      if (!application) {
        throw new Error("Loan application not found");
      }

      // Try to find template in database first
      const template = await DocumentTemplate.findOne({
        code: templateCode,
        is_active: true,
      }).lean();

      // Fetch the associated loan (if exists) - needed for pawn contract
      let loan = null;
      try {
        loan = await Loan.findOne({ application: loanApplicationId }).lean();
        if (loan) {
          console.log(`Found loan ${loan.loan_no} for application`);
        }
      } catch (loanError) {
        console.log("No loan found for application, using application data only");
      }

      // Fetch the asset details (vehicle/electronics/jewellery)
      let asset = null;
      try {
        if (loan && loan.asset) {
          asset = await Asset.findById(loan.asset).lean();
          if (asset) {
            console.log(`Found asset ${asset.asset_no} for loan`);
          }
        } else if (application.asset) {
          // Try to get asset directly from application if no loan
          asset = await Asset.findById(application.asset).lean();
        }
      } catch (assetError) {
        console.log("No asset found for application");
      }

      // Prepare document data with all related info
      const documentData = {
        application,
        loan,
        asset,
        templateCode
      };

      // Get the template file path and type
      const templateInfo = this._getTemplateFilePath(templateCode);
      
      let pdfBuffer;
      let finalPdfPath;
      
      if (templateInfo) {
        console.log(`Using ${templateInfo.type.toUpperCase()} template: ${templateInfo.path}`);
        
        if (templateInfo.type === 'pdf') {
          // For PDF templates, try to fill form fields or use fallback
          try {
            // Determine template type for field mapping
            let templateType = 'LOAN_REQUEST_FORM';
            if (templateCode === 'PAWN_CONTRACT_MOTOR_VEHICLE') {
              templateType = 'PAWN_CONTRACT_MOTOR_VEHICLE';
            } else if (templateCode === 'PAWN_CONTRACT_ELECTRICALS') {
              templateType = 'PAWN_CONTRACT_ELECTRICALS';
            }
            
      // Prepare form data from application, loan, and asset
            // If asset is not available, try to extract vehicle info from collateral_description
            let enrichedFormData = { ...application };
            
            // If no asset but we have collateral_description, try to extract vehicle info
            if (!asset && application.collateral_description) {
              const collateralDesc = application.collateral_description;
              
              // Try to parse "Toyota Regius 2012" format
              const descParts = collateralDesc.trim().split(/\s+/);
              if (descParts.length >= 1) {

  enrichedFormData.make = descParts[0];
  enrichedFormData.vehicle_make = descParts[0]; // Add for PDF field mapping
}
if (descParts.length >= 2) {
  const modelStr = descParts.slice(1, -1).join(' ') || descParts[1];
  enrichedFormData.model = modelStr;
  enrichedFormData.vehicle_model = modelStr; // Add for PDF field mapping
}

              if (descParts.length >= 3) {
                enrichedFormData.year = descParts[descParts.length - 1];
              }
              // Auto-generate amount_in_words if not provided
if (!enrichedFormData.amount_in_words && enrichedFormData.requested_loan_amount) {
  enrichedFormData.amount_in_words = this._numberToWords(enrichedFormData.requested_loan_amount);
  console.log('Auto-generated amount_in_words:', enrichedFormData.amount_in_words);
}
              // Also use collateral_description as fallback for vehicle details
              enrichedFormData.collateral_description = collateralDesc;
              
              console.log('Extracted from collateral_description:', {
                make: enrichedFormData.make,
                model: enrichedFormData.model,
                year: enrichedFormData.year
              });
            }
            
            // Add loan and asset data
            enrichedFormData.loan = loan;
            enrichedFormData.asset = asset;
            
            const formData = enrichedFormData;
            
            // Try to fill the PDF form fields
            const filledPdfBytes = await this.fillPdfFormFields(templateInfo.path, formData, templateType);
            
            // Save the filled PDF
            const uniqueId = uuidv4().slice(0, 8);
            finalPdfPath = path.join(docsDir, `app_${loanApplicationId}_${uniqueId}.pdf`);
            fs.writeFileSync(finalPdfPath, filledPdfBytes);
            console.log(`PDF form fields filled successfully`);
          } catch (fillError) {
            console.log(`PDF form filling failed: ${fillError.message}, using fallback PDF generation`);
            // Fallback to programmatic PDF generation with loan and asset data
            finalPdfPath = await this._generateFallbackPdf(documentData);
          }
        } else {
          // For DOCX templates, convert to PDF
          const uniqueId = uuidv4().slice(0, 8);
          const docxOutputPath = path.join(docsDir, `app_${loanApplicationId}_${uniqueId}.docx`);
          finalPdfPath = path.join(docsDir, `app_${loanApplicationId}_${uniqueId}.pdf`);
          
          // Copy the .docx template to output location
          fs.copyFileSync(templateInfo.path, docxOutputPath);
          
          // Try to convert docx to pdf
          try {
            await this._convertDocxToPdf(docxOutputPath, finalPdfPath);
          } catch (convError) {
            console.log("docx-pdf conversion failed, using fallback PDF generation");
            // Fallback to programmatic PDF generation with loan and asset data
            finalPdfPath = await this._generateFallbackPdf(documentData);
          }
          
          // Clean up intermediate docx file
          if (fs.existsSync(docxOutputPath)) {
            fs.unlinkSync(docxOutputPath);
          }
        }
      } else {
        console.log(`Template file not found for ${templateCode}, using fallback PDF generation`);
        // Fallback to programmatic PDF generation with loan and asset data
        finalPdfPath = await this._generateFallbackPdf(documentData);
      }

      // Read the generated PDF
      if (!fs.existsSync(finalPdfPath)) {
        throw new Error("Failed to generate PDF document");
      }
      
      const fileBuffer = fs.readFileSync(finalPdfPath);
      const base64String = fileBuffer.toString("base64");
      
      // Get template info
      const templateId = template ? template._id : null;

      // Create SignedDocument record
      const signedDoc = new SignedDocument({
        template_id: templateId,
        template_code_snapshot: templateCode,
        applicant_user_id: application.customer_user,
        loan_application_id: loanApplicationId,
        file_url: path.basename(finalPdfPath),
        mime_type: "application/pdf",
        status: "uploaded",
      });

      await signedDoc.save();

      console.log(`PDF generated successfully: ${path.basename(finalPdfPath)}`);
      return {
        success: true,
        signedDocumentId: signedDoc._id,
        filename: path.basename(finalPdfPath),
        base64: base64String,
        mimeType: "application/pdf",
        message: "Document generated successfully",
      };
    } catch (error) {
      console.error("Error generating document:", error);
      throw new Error(`Failed to generate document: ${error.message}`);
    }
  }

/**
   * Fallback PDF generation using pdfkit - Creates comprehensive Real Time Capital documents
   * Now supports filling in data from loan and asset
   */
  async _generateFallbackPdf(documentData) {
    const PDFDocument = require("pdfkit");
    const { application, loan, asset, templateCode } = documentData;
    
    return new Promise(async (resolve, reject) => {
      try {
        const pdfDoc = new PDFDocument({ size: "A4", margin: 50 });
        const fileName = `app_${application._id}_${uuidv4().slice(0, 8)}.pdf`;
        const filePath = path.join(docsDir, fileName);
        
        const stream = fs.createWriteStream(filePath);
        pdfDoc.pipe(stream);

        // Helper function to safely repeat dots
        const dotRepeat = (len) => ".".repeat(Math.max(0, len));

        // ===== COMPANY HEADER =====
        pdfDoc.font("Helvetica-Bold").fontSize(14);
        pdfDoc.text("DESIGNIT MEDIA (PVT) LTD", { align: "center" });
        
        pdfDoc.font("Helvetica").fontSize(10);
        pdfDoc.text("t/a REAL TIME CAPITAL", { align: "center" });
        
        pdfDoc.fontSize(9);
        pdfDoc.text("4th Floor Batanai Gardens Suite 422", { align: "center" });
        pdfDoc.text("Number 59 Jason Moyo Avenue, Harare", { align: "center" });
        pdfDoc.text("Harare", { align: "center" });
        
        pdfDoc.moveDown(0.5);
        pdfDoc.text("Contacts: Tel: 0242-792626/7", { align: "center" });
        pdfDoc.text("Cell: 0774 848040/0774189128", { align: "center" });
        
        pdfDoc.moveDown();
        
        // ===== TEMPLATE TITLE =====
        const templateTitles = {
          "LOAN_REQUEST_FORM": "LOAN REQUEST FORM",
          "PAWN_CONTRACT_MOTOR_VEHICLE": "SPECIAL CONTRACT: PAWN TICKET AND DISCLOSURE",
          "PAWN_CONTRACT_ELECTRICALS": "SPECIAL CONTRACT: PAWN TICKET AND DISCLOSURE"
        };
        
        pdfDoc.font("Helvetica-Bold").fontSize(12);
        pdfDoc.text(templateTitles[templateCode] || "LOAN APPLICATION", { align: "center" });
        
        pdfDoc.moveDown();
        pdfDoc.font("Helvetica").fontSize(9);
        pdfDoc.text("Please fill in all parts of this document, false information may result in the application dismissal", { align: "center" });
        
        pdfDoc.moveDown(2);

        // ===== PAWN CONTRACT HEADER (For pawn contracts) =====
        const isPawnContract = templateCode === "PAWN_CONTRACT_MOTOR_VEHICLE" || templateCode === "PAWN_CONTRACT_ELECTRICALS";
        
        if (isPawnContract) {
          // FOR THE VALUE RECEIVED section
          pdfDoc.font("Helvetica-Bold").fontSize(10);
          pdfDoc.text("FOR THE VALUE RECEIVED, I, the undersigned (The Pawner),", { align: "left" });
          pdfDoc.moveDown(0.5);
          
          // Full Name from application
          pdfDoc.font("Helvetica").fontSize(10);
          const fullName = String(application.full_name || "");
          pdfDoc.text(`Name................................................................................ ${fullName}`, { underline: false });
          
          // ID Number
          const idNum = String(application.national_id_number || "");
          pdfDoc.text(`ID No........................................... ${idNum}`, { underline: false });
          
          // Address
          const address = String(application.home_address || "");
          pdfDoc.text(`Address............................................................................................................ ${address}`, { underline: false });
          
          // Contact Number
          const contact = String(application.contact_details || "");
          pdfDoc.text(`Contact No........................................................................... ${contact}`, { underline: false });
          
          pdfDoc.moveDown(0.5);
          pdfDoc.font("Helvetica-Bold").fontSize(10);
          pdfDoc.text("Hereby promise to pay to the order of Designit Media P/Ltd t/a REAL TIME CAPITAL (The Pawn Broker),", { align: "left" });
          pdfDoc.text("in accordance with the terms and conditions set forth below, the sum of", { align: "left" });
          pdfDoc.moveDown(0.5);
          
          // Loan Amount - use loan principal_amount if available, otherwise use application requested_loan_amount
          const loanAmount = loan && loan.principal_amount ? loan.principal_amount : (application.requested_loan_amount || 0);
          const loanAmountStr = loanAmount.toFixed(2);
          pdfDoc.font("Helvetica").fontSize(10);
          pdfDoc.text(`USD ${loanAmountStr}`, { align: "left" });
          
          // In words - basic number to words conversion
          const amountInWords = this._numberToWords(loanAmount);
          pdfDoc.text(`In words.................................................................................... ${amountInWords}`, { underline: false });
          
          pdfDoc.moveDown(2);
          
          // ASSET PLEDGED section
          pdfDoc.font("Helvetica-Bold").fontSize(10);
          pdfDoc.text("ASSET PLEDGED: " + (templateCode === "PAWN_CONTRACT_MOTOR_VEHICLE" ? "MOTOR VEHICLE" : "ELECTRONICS"), { underline: true });
          pdfDoc.moveDown(0.5);
          
          pdfDoc.font("Helvetica").fontSize(10);
          
          // For motor vehicle pawn contracts, extract vehicle info from asset or collateral_description
          if (templateCode === "PAWN_CONTRACT_MOTOR_VEHICLE") {
            let make = "";
            let model = "";
            let regNo = "";
            let ccSerial = "";
            let engineNo = "";
            let chassisNo = "";
            
            // First try to get from asset
            if (asset) {
              make = String(asset.make || "");
              model = String(asset.model || "");
              regNo = String(asset.registration_no || "");
              ccSerial = String(asset.cc_serial_no || "");
              engineNo = String(asset.engine_no || "");
              chassisNo = String(asset.chassis_no || "");
            }
            
            // If no asset data, try to extract from collateral_description
            if (!make && application.collateral_description) {
              const collateralDesc = application.collateral_description;
              const descParts = collateralDesc.trim().split(/\s+/);
              if (descParts.length >= 1) make = descParts[0];
              if (descParts.length >= 2) model = descParts.slice(1).join(' ');
            }
            
            pdfDoc.text(`MAKE : ${make}`, { align: "left" });
            pdfDoc.text(`MODEL : ${model}`, { align: "left" });
            pdfDoc.text(`REGISTRATION NO. : ${regNo}`, { align: "left" });
            pdfDoc.text(`CC SERIAL NO. : ${ccSerial}`, { align: "left" });
            pdfDoc.text(`ENGINE NO. : ${engineNo}`, { align: "left" });
            pdfDoc.text(`CHASSIS NO : ${chassisNo}`, { align: "left" });
          } else if (templateCode === "PAWN_CONTRACT_ELECTRICALS") {
            // Electronics details - try asset first, then fallback to collateral_description
            let brand = "";
            let model = "";
            let serialNo = "";
            
            // First try to get from asset
            if (asset) {
              brand = String(asset.brand || "");
              model = String(asset.model || "");
              serialNo = String(asset.serial_no || "");
            }
            
            // If no asset data, try to extract from collateral_description
            if (!brand && application.collateral_description) {
              const collateralDesc = application.collateral_description;
              const descParts = collateralDesc.trim().split(/\s+/);
              if (descParts.length >= 1) brand = descParts[0];
              if (descParts.length >= 2) model = descParts.slice(1).join(' ');
            }
            
            pdfDoc.text(`BRAND : ${brand}`, { align: "left" });
            pdfDoc.text(`MODEL : ${model}`, { align: "left" });
            pdfDoc.text(`SERIAL NO. : ${serialNo}`, { align: "left" });
          }
          
          pdfDoc.moveDown(2);
        }

        // ===== PERSONAL DETAILS SECTION (For Loan Request Form) =====
        if (templateCode === "LOAN_REQUEST_FORM") {
          pdfDoc.font("Helvetica-Bold").fontSize(11);
          pdfDoc.text("PERSONAL DETAILS", { underline: true });
          pdfDoc.moveDown(0.5);
          
          // Full Name
          pdfDoc.font("Helvetica").fontSize(10);
          const fullName = String(application.full_name || "");
          pdfDoc.text(`Full Name: ${dotRepeat(40)} ${fullName}`, { underline: true });
          
          // National ID
          const idNum = String(application.national_id_number || "");
          pdfDoc.text(`National Identificationnumber: ${dotRepeat(30)} ${idNum}`, { underline: true });
          
          // Gender
          const gender = String(application.gender || "");
          pdfDoc.text(`Gender: ${dotRepeat(45)} ${gender}`, { underline: true });
          
          pdfDoc.moveDown(0.5);
          
          // Date of Birth
          const dob = application.date_of_birth ? new Date(application.date_of_birth).toLocaleDateString() : "";
          pdfDoc.text(`Date of Birth: ${dotRepeat(35)} ${dob}`, { underline: true });
          
          // Marital Status
          const marital = String(application.marital_status || "");
          pdfDoc.text(`Marital status: ${dotRepeat(35)} ${marital}`, { underline: true });
          
          pdfDoc.moveDown(0.5);
          
          // Contact Details
          const contact = String(application.contact_details || "");
          pdfDoc.text(`Contact details: ${dotRepeat(38)} ${contact}`, { underline: true });
          
          // Alternative Number
          const altContact = String(application.alternative_number || "");
          pdfDoc.text(`Alternative number: ${dotRepeat(32)} ${altContact}`, { underline: true });
          
          pdfDoc.moveDown(0.5);
          
          // Email
          const email = String(application.email_address || "");
          pdfDoc.text(`Email Address: ${dotRepeat(38)} ${email}`, { underline: true });
          
          // Home Address
          const address = String(application.home_address || "");
          pdfDoc.text(`Home Address: ${dotRepeat(38)} ${address}`, { underline: true });
          
          pdfDoc.moveDown(2);

          // ===== EMPLOYMENT DETAILS SECTION =====
          pdfDoc.font("Helvetica-Bold").fontSize(11);
          pdfDoc.text("EMPLOYMENT DETAILS", { underline: true });
          pdfDoc.moveDown(0.5);
          
          const emp = application.employment || {};
          
          pdfDoc.font("Helvetica").fontSize(10);
          const empType = String(emp.employment_type || "");
          pdfDoc.text(`Type of employment: ${dotRepeat(30)} ${empType}`, { underline: true });
          
          const empTitle = String(emp.title || "");
          pdfDoc.text(`Title: ${dotRepeat(45)} ${empTitle}`, { underline: true });
          
          pdfDoc.moveDown(0.5);
          
          const duration = String(emp.duration || "");
          pdfDoc.text(`Duration: ${dotRepeat(40)} ${duration}`, { underline: true });
          
          const location = String(emp.location || "");
          pdfDoc.text(`Location: ${dotRepeat(40)} ${location}`, { underline: true });
          
          pdfDoc.moveDown(0.5);
          
          const empContacts = String(emp.contacts || "");
          pdfDoc.text(`Contacts: ${dotRepeat(42)} ${empContacts}`, { underline: true });
          
          pdfDoc.moveDown(2);

          // ===== BASIC INFORMATION SECTION =====
          pdfDoc.font("Helvetica-Bold").fontSize(11);
          pdfDoc.text("BASIC INFORMATION", { underline: true });
          pdfDoc.moveDown(0.5);
          
          // Loan Amount - prefer loan data over application data
          pdfDoc.font("Helvetica").fontSize(10);
          const loanAmount = loan && loan.principal_amount ? loan.principal_amount : (application.requested_loan_amount || 0);
          const loanAmountStr = loanAmount.toFixed(2);
          pdfDoc.text(`Loan Amount: $${dotRepeat(42)} ${loanAmountStr}`, { underline: true });
          
          // In words
          const amountInWords = this._numberToWords(loanAmount);
          pdfDoc.text(`In Words: ${dotRepeat(45)} ${amountInWords}`, { underline: true });
          
          pdfDoc.moveDown(0.5);
          
          // Collateral
          const collateral = String(application.collateral_category || "");
          pdfDoc.text(`Collateral: ${dotRepeat(42)} ${collateral}`, { underline: true });
          
          // Description of Surety
          const surety = String(application.surety_description || application.collateral_description || "");
          pdfDoc.text(`Description of surety: ${dotRepeat(30)} ${surety}`, { underline: true });
          
          pdfDoc.moveDown(0.5);
          
          // Asset Value - prefer loan data over application data
          const assetValue = loan && loan.principal_amount ? loan.principal_amount : (application.declared_asset_value || 0);
          const assetValueStr = assetValue.toFixed(2);
          pdfDoc.text(`Asset value: $${dotRepeat(42)} ${assetValueStr}`, { underline: true });
          
          // Asset Details
          pdfDoc.moveDown(0.5);
          pdfDoc.font("Helvetica-Bold").fontSize(11);
          pdfDoc.text("ASSET DETAILS:", { underline: true });
          pdfDoc.moveDown(0.5);
          
          const isMotorVehicle = application.collateral_category === "motor_vehicle";
          
          pdfDoc.font("Helvetica").fontSize(10);
          if (isMotorVehicle && asset) {
            const vehicle = asset;
            const make = String(vehicle.make || "");
            const model = String(vehicle.model || "");
            const regNo = String(vehicle.registration_no || "");
            const ccSerial = String(vehicle.cc_serial_no || "");
            const engineNo = String(vehicle.engine_no || "");
            const chassisNo = String(vehicle.chassis_no || "");
            
            pdfDoc.text(`Make: ${dotRepeat(50)} ${make}`, { underline: true });
            pdfDoc.text(`Model: ${dotRepeat(48)} ${model}`, { underline: true });
            pdfDoc.moveDown(0.5);
            pdfDoc.text(`Registration No: ${dotRepeat(42)} ${regNo}`, { underline: true });
            pdfDoc.text(`CC Serial No: ${dotRepeat(40)} ${ccSerial}`, { underline: true });
            pdfDoc.moveDown(0.5);
            pdfDoc.text(`Engine No: ${dotRepeat(45)} ${engineNo}`, { underline: true });
            pdfDoc.text(`Chassis No: ${dotRepeat(43)} ${chassisNo}`, { underline: true });
          } else if (asset) {
            const electronics = asset;
            const brand = String(electronics.brand || "");
            const model = String(electronics.model || "");
            const serialNo = String(electronics.serial_no || "");
            
            pdfDoc.text(`Type: ${dotRepeat(52)} ${brand}`, { underline: true });
            pdfDoc.text(`Model: ${dotRepeat(48)} ${model}`, { underline: true });
            pdfDoc.moveDown(0.5);
            pdfDoc.text(`Serial No: ${dotRepeat(47)} ${serialNo}`, { underline: true });
          } else {
            // No asset data, leave blank
            pdfDoc.text(`Make: ${dotRepeat(50)} `, { underline: true });
            pdfDoc.text(`Model: ${dotRepeat(48)} `, { underline: true });
            pdfDoc.moveDown(0.5);
            pdfDoc.text(`Registration No: ${dotRepeat(42)} `, { underline: true });
            pdfDoc.text(`Serial No: ${dotRepeat(47)} `, { underline: true });
          }
          
          pdfDoc.moveDown(2);

          // ===== DECLARATION SECTION =====
          pdfDoc.font("Helvetica-Bold").fontSize(11);
          pdfDoc.text("DECLARATION", { underline: true });
          pdfDoc.moveDown(0.5);
          
          pdfDoc.font("Helvetica").fontSize(9);
          const declarationText = application.declaration_text || 
            "I hereby declare that all the information provided above is true and accurate to the best of my knowledge. I agree to the terms and conditions set forth in this agreement.";
          
          pdfDoc.text(declarationText, {
            align: "justify",
            width: 495,
          });
          
          pdfDoc.moveDown(2);
          
          // Declaration signature
          pdfDoc.text("Date: ___________________    Signature: ________________________________", { align: "center" });
          
          pdfDoc.moveDown(3);
        }

        // ===== PAWN CONTRACT TERMS =====
        if (isPawnContract) {
          pdfDoc.font("Helvetica-Bold").fontSize(12);
          pdfDoc.text("SPECIAL TERMS AND CONDITIONS", { underline: true });
          pdfDoc.moveDown();
          
          pdfDoc.font("Helvetica").fontSize(9);
          
          // Due Date section - use loan due_date if available
          pdfDoc.font("Helvetica-Bold").fontSize(10);
          pdfDoc.text("1. Due Date");
          pdfDoc.font("Helvetica").fontSize(9);
          
          let dueDateStr = "___________________";
          if (loan && loan.due_date) {
            dueDateStr = new Date(loan.due_date).toLocaleDateString();
          }
          pdfDoc.text(`1.1 The amount is due and payable on or before ${dueDateStr}`, { align: "left" });
          pdfDoc.text("1.2 Pawned items to be collected within 24 hours after payment", { align: "left" });
          pdfDoc.text("1.3 A penalty of 10% shall be charged on total amount due if the payment is not effected on due date but paid within 7 days grace period", { align: "left" });
          pdfDoc.moveDown();
          
          // Charges section - use loan interest_rate_percent and storage_charge_percent if available
          pdfDoc.font("Helvetica-Bold").fontSize(10);
          const chargesText = templateCode === "PAWN_CONTRACT_MOTOR_VEHICLE" ? 
            "2. Charges - 25% per every 30 days" : "2. Charges - 20% per two Weeks";
          pdfDoc.text(chargesText);
          pdfDoc.font("Helvetica").fontSize(9);
          pdfDoc.text("These charges are included in the sum to be paid:");
          
          // Use loan interest rate if available
          const interestRate = loan && loan.interest_rate_percent ? loan.interest_rate_percent : 
            (templateCode === "PAWN_CONTRACT_MOTOR_VEHICLE" ? 4 : 2);
          const interestPeriod = loan && loan.interest_period_days ? loan.interest_period_days : 
            (templateCode === "PAWN_CONTRACT_MOTOR_VEHICLE" ? 30 : 14);
          
          let interestText;
          if (templateCode === "PAWN_CONTRACT_MOTOR_VEHICLE") {
            interestText = `2.1 The Pawn Broker charges interest at the rate of ${interestRate}% per every ${interestPeriod} days and any period less than 15 days will be charged at 2%.`;
          } else {
            interestText = `2.1 The Pawn Broker charges interest at the rate of ${interestRate}% per every ${interestPeriod} days.`;
          }
          pdfDoc.text(interestText);
          
          // Use loan storage charge if available
          const storageCharge = loan && loan.storage_charge_percent ? loan.storage_charge_percent : 
            (templateCode === "PAWN_CONTRACT_MOTOR_VEHICLE" ? 21 : 18);
          const storageText = templateCode === "PAWN_CONTRACT_MOTOR_VEHICLE" ?
            `2.2 Storage charges are ${storageCharge}% of the sum received.` :
            `2.2 Storage charges are ${storageCharge}% of the sum received.`;
          pdfDoc.text(storageText);
          pdfDoc.moveDown();
          
          // Recourse section
          pdfDoc.font("Helvetica-Bold").fontSize(10);
          pdfDoc.text("3. Recourse");
          pdfDoc.font("Helvetica").fontSize(9);
          pdfDoc.text("3.1 After the redemption date, unredeemed pledges will be sold but may be redeemed anytime before sale. The Pawnbroker need not make any demands, i.e. dies interpellat pro homine and the Pawner is in mora ex re if he/she fails to pay on the agreed date.");
          pdfDoc.text("3.2 This agreement is parate executie, meaning sale without Court order is permissible.");
          pdfDoc.text("3.3 After the Redemption date, the Pawner authorizes the Pawn Broker to sell or change ownership of the pledge using this Agreement and the signed Change of Ownership Affidavit to any willing buyer without seeking further consent and authorization.");
          pdfDoc.text("3.4 All pledges are left at owners' risk caused by natural disasters and the Pawn broker will not compensate for pledges which cease functioning whilst in his custody.");
          pdfDoc.text("3.5 The Pawner accepts that no failure on part of the Pawn Broker to immediately enforce payment or other rights or any relaxation or indulgence will constitute a waiver or alteration of his rights or a bar to enforcing them subsequently.");
          pdfDoc.text("3.6 The Pawner grants the Pawn broker and its officials the power of substitution, to be the true and lawful attorney in his/her name, place and stead to appear before any Government authorities and then act and deed to make transfer to the purchaser.");
          pdfDoc.text("3.7 This Agreement and the annexures can only be amended in writing and signed by both parties.");
          pdfDoc.moveDown();
          
          // Payments section
          pdfDoc.font("Helvetica-Bold").fontSize(10);
          pdfDoc.text("4. Payments");
          pdfDoc.font("Helvetica").fontSize(9);
          pdfDoc.text("4.1 All payments will be made in CASH ONLY and in the Currency disbursed in this agreement which is UNITED STATES DOLLARS.");
          pdfDoc.text("4.2 No other currency, including but not limited to, Bond notes, South African Rand, Yuan, Euro, OR any other forms of payments including but not limited to, Zimbzbwean Gold (ZIG), Zimbabwe Instant Payment Transaction (ZIPIT), Ecocash, Telecash, One Wallet, Net cash OR any other currency or form of payment that may become legal tender in Zimbabwe shall be accepted until this contract is fully extinguished.");
          pdfDoc.moveDown();
          
          // Indemnity section
          pdfDoc.font("Helvetica-Bold").fontSize(10);
          pdfDoc.text("5. Indemnity");
          pdfDoc.font("Helvetica").fontSize(9);
          pdfDoc.text("5.1 The Pawner declares that he/she is the rightful owner or has been authorized or employed by the owner thereof to pawn the pledge.");
          pdfDoc.text("5.2 The Pawner does hereby undertake and engage not to make any claims against the Pawn Broker and its Officials and indemnify them from any claims or demands from third parties for or on account of the pledged asset.");
          pdfDoc.text("5.3 The Pawner agrees that any sale of the pledge in this agreement after the due date has his/her authority and consent hence such sale will not constitute any criminal offence and cannot be treated as theft of trust property.");
          pdfDoc.moveDown();
          
          // Disputes section
          pdfDoc.font("Helvetica-Bold").fontSize(10);
          pdfDoc.text("6. Disputes");
          pdfDoc.font("Helvetica").fontSize(9);
          pdfDoc.text("Any disputes that may arise between the parties shall have the jurisdiction of the Magistrates' Court, Harare.");
        }
        
        pdfDoc.moveDown(3);

        // ===== SIGNATURE BLOCKS =====
        pdfDoc.font("Helvetica").fontSize(10);
        
        if (isPawnContract) {
          // Get current date for signature
          const signDate = new Date().toLocaleDateString();
          pdfDoc.text(`Signed: ________________________________    Date: ${signDate}`, { align: "center" });
          pdfDoc.text("Pawner");
          
          pdfDoc.moveDown(2);
          
          pdfDoc.text(`Signed: ________________________________    Date: ${signDate}`, { align: "center" });
          pdfDoc.text("Pawn Broker");
        } else {
          pdfDoc.text("Signed: ______________________________    Date: ___________________");
          pdfDoc.text("Pawner");
          
          pdfDoc.moveDown(2);
          
          pdfDoc.text("Signed: ______________________________    Date: ___________________");
          pdfDoc.text("Pawn Broker");
        }
        
        pdfDoc.moveDown(2);
        
        // ===== FOOTER =====
        pdfDoc.fontSize(8).fillColor("#666666");
        pdfDoc.text("DESIGNIT MEDIA (PVT) LTD t/a REAL TIME CAPITAL", { align: "center" });

        // End PDF
        pdfDoc.end();

        stream.on("finish", () => {
          resolve(filePath);
        });

        stream.on("error", (err) => {
          reject(err);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Helper function to convert number to words
   */
  _numberToWords(number) {
    if (number === 0) return "Zero";
    
    const units = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 
                  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    
    const numStr = Math.floor(number).toString();
    const parts = [];
    
    // Handle dollars
    let dollars = Math.floor(number);
    if (dollars > 0) {
      if (dollars < 20) {
        parts.push(units[dollars]);
      } else if (dollars < 100) {
        parts.push(tens[Math.floor(dollars / 10)]);
        if (dollars % 10 > 0) {
          parts.push(units[dollars % 10]);
        }
      } else if (dollars < 1000) {
        parts.push(units[Math.floor(dollars / 100)] + " Hundred");
        if (dollars % 100 > 0) {
          const remainder = dollars % 100;
          if (remainder < 20) {
            parts.push(units[remainder]);
          } else {
            parts.push(tens[Math.floor(remainder / 10)]);
            if (remainder % 10 > 0) {
              parts.push(units[remainder % 10]);
            }
          }
        }
      } else {
        // For larger numbers, just append the number
        parts.push(dollars.toString());
      }
    }
    
    // Handle cents
    const cents = Math.round((number - Math.floor(number)) * 100);
    if (cents > 0) {
      parts.push("and");
      if (cents < 20) {
        parts.push(units[cents]);
      } else {
        parts.push(tens[Math.floor(cents / 10)]);
        if (cents % 10 > 0) {
          parts.push(units[cents % 10]);
        }
      }
      parts.push("cents");
    }
    
    return parts.join(' ').trim() + " United States Dollars";
  }

  /**
   * Add a field to the PDF in a formatted way
   */
  _addField(pdfDoc, label, value) {
    try {
      const displayValue = (value === undefined || value === null) ? "N/A" : value;
      pdfDoc.text(`${label} ${displayValue}`, { width: 500 });
    } catch (fieldError) {
      console.error(`Error adding field ${label}:`, fieldError.message);
      pdfDoc.text(`${label} N/A`, { width: 500 });
    }
  }

  /**
   * Embed a signature image into the PDF at the specified field location
   * 
   * @param {Object} pdfDoc - The pdf-lib PDF document
   * @param {string} signatureValue - Base64 encoded signature image (PNG or JPG)
   * @param {string} fieldName - Name of the field to embed the image at
   * @returns {Promise<void>}
   */
  async _embedSignatureImage(pdfDoc, signatureValue, fieldName) {
    try {
      // Check if signatureValue is a base64 string or URL
      let base64Data = signatureValue;
      
      // If it's a data URL, extract the base64 part
      if (signatureValue.startsWith('data:')) {
        base64Data = signatureValue.replace(/^data:[^;]+;base64,/, "");
      }
      
      // Detect the format (PNG or JPEG)
      const signatureBuffer = Buffer.from(base64Data, "base64");
      const firstBytes = Buffer.from(signatureBuffer.slice(0, 8));
      
      let signatureImage;
      let imageType;
      
      if (firstBytes[0] === 0x89 && firstBytes[1] === 0x50 && firstBytes[2] === 0x4E && firstBytes[3] === 0x47) {
        // PNG
        imageType = 'png';
        signatureImage = await pdfDoc.embedPng(signatureBuffer);
      } else if (firstBytes[0] === 0xFF && firstBytes[1] === 0xD8 && firstBytes[2] === 0xFF) {
        // JPEG
        imageType = 'jpeg';
        signatureImage = await pdfDoc.embedJpg(signatureBuffer);
      } else {
        console.log(`Unsupported signature image format for field: ${fieldName}`);
        return;
      }
      
      // Try to get the field from the form to determine position
      try {
        const form = pdfDoc.getForm();
        const field = form.getField(fieldName);
        
        if (field) {
          // Get the field's widget rectangle
          const widget = field['fields'][0]['widgets'][0];
          if (widget && widget['rect']) {
            const rect = widget['rect'];
            const x = rect['x'];
            const y = rect['y'];
            const width = rect['width'];
            const height = rect['height'];
            
            // Get the page containing this field
            const pages = pdfDoc.getPages();
            
            // Find the page that contains this field (simplified - assumes first page)
            const page = pages[0];
            
            // Draw the signature image
            page.drawImage(signatureImage, {
              x: x,
              y: y,
              width: width,
              height: height,
            });
            
            console.log(`Signature image embedded at field ${fieldName}: x=${x}, y=${y}, width=${width}, height=${height}`);
            return;
          }
        }
      } catch (fieldError) {
        console.log(`Could not find field ${fieldName}, using default positioning`);
      }
      
      // Default positioning if field not found - place on first page
      const pages = pdfDoc.getPages();
      const page = pages[0];
      const { height: pageHeight, width: pageWidth } = page.getSize();
      
      // Default to bottom-right corner of the page
      const defaultWidth = 150;
      const defaultHeight = 50;
      const xPos = pageWidth - defaultWidth - 50;
      const yPos = 50;
      
      page.drawImage(signatureImage, {
        x: xPos,
        y: yPos,
        width: defaultWidth,
        height: defaultHeight,
      });
      
      console.log(`Signature image embedded at default position: x=${xPos}, y=${yPos}`);
      
    } catch (error) {
      console.error(`Error embedding signature image: ${error.message}`);
      // Don't throw - just log the error and continue
    }
  }

  /**
   * Fill PDF form fields with loan application data using pdf-lib
   * 
   * @param {string} pdfTemplatePath - Path to the PDF template with form fields
   * @param {Object} formData - JSON object containing the form field values
   * @param {string} templateType - Type of template: 'LOAN_REQUEST_FORM' or 'PAWN_CONTRACT'
   * @returns {Promise<Buffer>} - Filled PDF as buffer
   */
  async fillPdfFormFields(pdfTemplatePath, formData, templateType = 'LOAN_REQUEST_FORM') {
    try {
      // Load the PDF template
      const pdfBytes = fs.readFileSync(pdfTemplatePath);
      const pdfDoc = await PDFLibDocument.load(pdfBytes);
      
      // Get the form
      const form = pdfDoc.getForm();
      
      // Field mappings based on template type
      let fieldMappings = {};
      
      if (templateType === 'PAWN_CONTRACT_MOTOR_VEHICLE') {
        // Pawn Contract Motor Vehicle field mappings
        fieldMappings = {
          // Personal Details
          'full_name': 'Name',
          'national_id_number': 'ID_No',
          'home_address': 'Address',
          'contact_details': 'Contact_No',
          
          // Loan Details
          'requested_loan_amount': 'USD',
          'amount_in_words': 'In words',
          
          // Vehicle Details
          'collateral_description': 'Vehicle_Details',
          'vehicle_make': 'Make',
          'vehicle_model': 'Model',
          'vehicle_registration_number': 'Registration_No',
          'vehicle_cc_serial_number': 'CC Serial_No',
          'vehicle_engine_number': 'Engine_No',
          'vehicle_chassis_number': 'Classis_No',
          
          // Due Date
          'due_date': 'Due_Date',
          
          // Signature Dates
          'signature_pawner_date': 'Date_Pawner',
          'signature_broker_date': 'Date_Broker'
        };
      } else if (templateType === 'PAWN_CONTRACT_ELECTRICALS') {
        // Pawn Contract Electricals/Jewellery field mappings
        fieldMappings = {
          // Personal Details
          'full_name': 'Name',
          'national_id_number': 'ID_No',
          'home_address': 'Address',
          'contact_details': 'Contact_No',
          
          // Loan Details
          'requested_loan_amount': 'USD',
          'amount_in_words': 'In words',
          
          // Item Details
          'collateral_description': 'Item_Details',
          'item_type': 'Type',
          'item_model': 'Model',
          'item_serial_number': 'Serial_No',
          
          // Due Date
          'due_date': 'Due_Date',
          
          // Signature Dates
          'signature_pawner_date': 'Date_Pawner',
          'signature_broker_date': 'Date_Broker'
        };
      } else {
        // Loan Request Form field mappings - Using exact PDF field names (without trailing X)
        fieldMappings = {
          // Personal Details
          'full_name': 'Full Name',
          'national_id_number': 'National Identification Number',
          'gender': 'Gender',
          'date_of_birth': 'Date of Birth',
          'marital_status': 'Marital status',
          'contact_details': 'Contact details',
          'alternative_number': 'Alternative number',
          'email_address': 'Email Address',
          'home_address': 'Home Address',
          
          // Employment Details - nested employment object
          'employment.employment_type': 'Type of employment',
          'employment.title': 'Title',
          'employment.duration': 'Duration',
          'employment.location': 'Location',
          'employment.contacts': 'Contacts',
          
          // Also support flattened employment fields
          'employment_type': 'Type of employment',
          'employment_title': 'Title',
          'employment_duration': 'Duration',
          'employment_location': 'Location',
          'employment_contacts': 'Contacts',
          
          // Basic Information
          'requested_loan_amount': 'loan amount',
          'collateral_category': 'Collateral',
          'surety_description': 'Description of surety',
          'declared_asset_value': 'Asset value',
          
          // Declaration
          'declaration_reason': 'Declaration Reason',
          'declaration_signed_at': 'Date',
          'declaration_signature_name': 'Signature',
          'signature_image_url': 'Signature'
        };
      }
      
      // Fill each field that exists in both the form and the data
      for (const [jsonField, pdfField] of Object.entries(fieldMappings)) {
        let value = formData[jsonField];

        // Handle nested employment object - extract from employment.employment_type, etc.
        if (value === undefined && jsonField.startsWith('employment.')) {
          const empField = jsonField.replace('employment.', '');
          value = formData.employment?.[empField];
        }
        
        // Handle flattened employment fields - employment_type, employment_title, etc.
        if (value === undefined && (jsonField === 'employment_type' || jsonField === 'employment_title' || jsonField === 'employment_duration' || jsonField === 'employment_location' || jsonField === 'employment_contacts')) {
          const empField = jsonField.replace('employment_', '');
          value = formData.employment?.[empField];
        }

        // Log the value being used for debugging
        console.log(`Processing field: ${jsonField} -> PDF: ${pdfField}, Value: ${value}`);

        if (value !== undefined && value !== null && value !== '') {
          try {
            // Check if this is a signature image field (signature_image_url)
            if (jsonField === 'signature_image_url') {
              // Embed signature image
              await this._embedSignatureImage(pdfDoc, value, pdfField);
              console.log(`Embedded signature image for field: ${pdfField}`);
              continue;
            }

            // Try to get the field from the form
            const field = form.getField(pdfField);

            if (field) {
              // Check field type and set value accordingly
              const fieldType = field.constructor.name;

              if (fieldType === 'PDFTextField') {
                field.setText(String(value));
              } else if (fieldType === 'PDFCheckBox') {
                field.check();
              } else if (fieldType === 'PDFDropdown') {
                field.select(String(value));
              } else if (fieldType === 'PDFRadioGroup') {
                field.select(String(value));
              } else {
                // Default: try to set as text
                try {
                  field.setText(String(value));
                } catch (e) {
                  console.log(`Could not fill field ${pdfField}:`, e.message);
                }
              }
              console.log(`Filled field: ${pdfField} = ${value}`);
            }
          } catch (fieldError) {
            // Field might not exist in the PDF, skip it
            console.log(`Field not found in PDF: ${pdfField}`);
          }
        }
      }
      
      // Save the filled PDF
      const filledPdfBytes = await pdfDoc.save();
      
      return Buffer.from(filledPdfBytes);
    } catch (error) {
      console.error('Error filling PDF form fields:', error);
      throw new Error(`Failed to fill PDF form fields: ${error.message}`);
    }
  }

  /**
   * Fill pawn contract PDF with loan application data
   * This is a specialized method for pawn contracts
   * 
   * @param {Object} applicationData - Loan application JSON data
   * @param {Object} assetData - Optional asset/vehicle data
   * @param {Object} loanData - Optional loan details
   * @returns {Promise<Object>} - Result with filled PDF base64 and path
   */
  async fillPawnContractPdf(applicationData, assetData = {}, loanData = {}) {
    try {
      // Combine all data
      const formData = {
        // Basic applicant info
        full_name: applicationData.full_name || '',
        national_id_number: applicationData.national_id_number || '',
        contact_details: applicationData.contact_details || '',
        home_address: applicationData.home_address || '',
        
        // Loan details
        requested_loan_amount: applicationData.requested_loan_amount ? 
          `$${applicationData.requested_loan_amount.toFixed(2)}` : '',
        loan_amount: applicationData.requested_loan_amount || 0,
        
        // Convert amount to words
        amount_in_words: applicationData.requested_loan_amount ? 
          this._numberToWords(applicationData.requested_loan_amount) : '',
        
        // Collateral/Vehicle details
        collateral_description: applicationData.collateral_description || '',
        make: assetData.make || applicationData.collateral_description?.split(' ')[0] || '',
        model: assetData.model || applicationData.collateral_description?.split(' ').slice(1).join(' ') || '',
        registration_no: assetData.registration_no || '',
        engine_no: assetData.engine_no || '',
        chassis_no: assetData.chassis_no || '',
        cc_serial_no: assetData.cc_serial_no || '',
        
        // Electricals
        brand: assetData.brand || '',
        serial_no: assetData.serial_no || '',
        
        // Additional personal details
        gender: applicationData.gender || '',
        date_of_birth: applicationData.date_of_birth ? 
          new Date(applicationData.date_of_birth).toLocaleDateString() : '',
        marital_status: applicationData.marital_status || '',
        email_address: applicationData.email_address || '',
        alternative_number: applicationData.alternative_number || '',
        
        // Employment (nested object)
        employment: applicationData.employment || {},
        employment_type: applicationData.employment?.employment_type || '',
        employer_title: applicationData.employment?.title || '',
        employment_duration: applicationData.employment?.duration || '',
        employment_location: applicationData.employment?.location || '',
        employment_contacts: applicationData.employment?.contacts || '',
        
        // Loan terms from loan data
        due_date: loanData.due_date ? 
          new Date(loanData.due_date).toLocaleDateString() : '',
        interest_rate: loanData.interest_rate_percent ? 
          `${loanData.interest_rate_percent}%` : ''
      };
      
      // Generate unique filename
      const uniqueId = uuidv4().slice(0, 8);
      const outputFileName = `filled_contract_${uniqueId}.pdf`;
      const outputPath = path.join(docsDir, outputFileName);
      
      // Try to load a PDF template if it exists, otherwise use fallback
      const templatePath = path.join(templatesDir, 'pawn_contract_template.pdf');
      
      let filledPdfBytes;
      
      if (fs.existsSync(templatePath)) {
        // Use PDF template with form fields
        filledPdfBytes = await this.fillPdfFormFields(templatePath, formData);
      } else {
        // No PDF template exists, generate using pdfkit (fallback)
        const fallbackPath = await this._generateFallbackPdf({
          application: formData,
          loan: loanData,
          asset: assetData,
          templateCode: 'PAWN_CONTRACT_MOTOR_VEHICLE'
        });
        filledPdfBytes = fs.readFileSync(fallbackPath);
      }
      
      // Save the filled PDF
      fs.writeFileSync(outputPath, filledPdfBytes);
      
      // Return result
      const base64String = filledPdfBytes.toString('base64');
      
      return {
        success: true,
        filename: outputFileName,
        filePath: outputPath,
        base64: base64String,
        mimeType: 'application/pdf',
        message: 'Pawn contract PDF filled successfully'
      };
    } catch (error) {
      console.error('Error filling pawn contract PDF:', error);
      throw new Error(`Failed to fill pawn contract PDF: ${error.message}`);
    }
  }

  /**
   * Upload signature and stamp it on PDF (returns base64)
   * Signature can be base64 encoded image (PNG, JPEG) or PDF
   * 
   * @param {string} signedDocumentId - The ID of the signed document
   * @param {string} signatureBase64 - Base64 encoded signature image
   * @param {string} signedByName - Name of the person signing
   * @param {string} signedByUserId - User ID of the signer
   * @param {Object} options - Optional signature placement options
   * @param {number} options.x - X coordinate for signature (from left edge)
   * @param {number} options.y - Y coordinate for signature (from bottom edge)
   * @param {number} options.width - Width of signature image
   * @param {number} options.height - Height of signature image
   * @param {boolean} options.placeOnLastPage - Whether to place on last page (default: true)
   */
  async stampSignatureOnDocument(signedDocumentId, signatureBase64, signedByName, signedByUserId, options = {}) {
    try {
      // Validate ObjectId format
      if (!mongoose.Types.ObjectId.isValid(signedDocumentId)) {
        throw new Error("Invalid document ID format");
      }

      const signedDoc = await SignedDocument.findById(signedDocumentId);
      if (!signedDoc) {
        throw new Error("Signed document not found");
      }

      const pdfPath = path.join(docsDir, signedDoc.file_url);
      if (!fs.existsSync(pdfPath)) {
        throw new Error("Original PDF file not found");
      }

      const signatureFormat = this._detectSignatureFormat(signatureBase64);
      console.log("Detected signature format:", signatureFormat);

      // Validate signature format
      if (!signatureFormat) {
        throw new Error("Invalid signature format. Must be PNG, JPEG, or PDF");
      }

      // Default options for signature placement
      const defaultOptions = {
        placeOnLastPage: true,  // Default to last page
        x: undefined,           // Will default to bottom-right
        y: undefined,           // Will default to bottom-right
        width: 150,            // Default width
        height: 75,            // Default height
      };
      
      // Merge user options with defaults
      const signatureOptions = { ...defaultOptions, ...options };
      
      console.log("Signature placement options:", signatureOptions);

      let base64Data = signatureBase64.replace(/^data:[^;]+;base64,/, "");
      const signatureBuffer = Buffer.from(base64Data, "base64");

      let processedSignature;

      if (signatureFormat === "pdf") {
        console.log("Processing PDF signature...");
        
        const originalPdfBytes = fs.readFileSync(pdfPath);
        const pdfDoc = await PDFLibDocument.load(originalPdfBytes);
        
        const signaturePdf = await PDFLibDocument.load(signatureBuffer);
        
        const signaturePageCount = signaturePdf.getPageCount();
        
        // Determine which page to add signature info to
        const pages = pdfDoc.getPages();
        const targetPageIndex = signatureOptions.placeOnLastPage ? pages.length - 1 : 0;
        const targetPage = pages[targetPageIndex];
        const { height: pageHeight, width: pageWidth } = targetPage.getSize();
        
        // Calculate position for bottom-right corner
        const defaultX = pageWidth - signatureOptions.width - 50; // 50px margin from right
        const defaultY = 50; // 50px margin from bottom
        
        // Use provided x,y or default to bottom-right
        const xPos = signatureOptions.x !== undefined ? signatureOptions.x : defaultX;
        const yPos = signatureOptions.y !== undefined ? signatureOptions.y : defaultY;
        
        // For PDF signatures, we copy pages but don't draw images on them
        // Just add the pages from the signature PDF
        for (let i = 0; i < signaturePageCount; i++) {
          const [signaturePage] = await pdfDoc.copyPages(signaturePdf, [i]);
          pdfDoc.addPage(signaturePage);
        }
        
        // Add signature info text at bottom-right of target page
        targetPage.drawText(`Signed by: ${signedByName}`, {
          x: xPos,
          y: yPos - 20,
          size: 10,
        });
        
        targetPage.drawText(`Signed at: ${new Date().toLocaleString()}`, {
          x: xPos,
          y: yPos - 35,
          size: 8,
        });
        
        const modifiedPdfBytes = await pdfDoc.save();
        
        const newFileName = `app_${signedDocumentId}_signed_${uuidv4().slice(0, 8)}.pdf`;
        const newPdfPath = path.join(docsDir, newFileName);
        fs.writeFileSync(newPdfPath, modifiedPdfBytes);
        
        const signedPdfBuffer = fs.readFileSync(newPdfPath);
        const signedBase64String = signedPdfBuffer.toString("base64");

        signedDoc.file_url = newFileName;
        signedDoc.signed_by_name = signedByName;
        signedDoc.signed_by_user_id = signedByUserId;
        signedDoc.signed_at = new Date();
        signedDoc.status = "verified";

        await signedDoc.save();

        console.log(`Signature stamped successfully: ${newFileName}`);
        return {
          success: true,
          signedDocumentId: signedDoc._id,
          filename: newFileName,
          base64: signedBase64String,
          mimeType: "application/pdf",
          signedAt: signedDoc.signed_at,
          signedBy: signedByName,
          message: "Document signed successfully",
        };
        
      } else {
        // Process as image (PNG or JPEG) - Embed onto existing PDF using pdf-lib
        console.log("Processing image signature and embedding onto existing PDF...");
        
        // Process signature image - resize based on options or default
        const sharp = require("sharp");
        processedSignature = await sharp(signatureBuffer)
          .resize(signatureOptions.width, signatureOptions.height, { fit: "inside", withoutEnlargement: true })
          .png()
          .toBuffer();

        // Load the original PDF
        const originalPdfBytes = fs.readFileSync(pdfPath);
        const pdfDoc = await PDFLibDocument.load(originalPdfBytes);
        
        // Embed the signature image
        const signatureImage = await pdfDoc.embedPng(processedSignature);
        
        // Get the target page (last page by default, or first page if specified)
        const pages = pdfDoc.getPages();
        const targetPageIndex = signatureOptions.placeOnLastPage ? pages.length - 1 : 0;
        const targetPage = pages[targetPageIndex];
        const { height: pageHeight, width: pageWidth } = targetPage.getSize();
        
        console.log(`Placing signature on page ${targetPageIndex + 1} of ${pages.length}`);
        console.log(`Page dimensions: ${pageWidth}x${pageHeight}`);
        
        // Calculate position for bottom-right corner by default
        const defaultX = pageWidth - signatureOptions.width - 50; // 50px margin from right
        const defaultY = 50; // 50px margin from bottom
        
        // Use provided x,y or default to bottom-right
        const xPos = signatureOptions.x !== undefined ? signatureOptions.x : defaultX;
        const yPos = signatureOptions.y !== undefined ? signatureOptions.y : defaultY;
        
        console.log(`Signature position: x=${xPos}, y=${yPos}, width=${signatureOptions.width}, height=${signatureOptions.height}`);
        
        // Draw signature image at specified position
        targetPage.drawImage(signatureImage, {
          x: xPos,
          y: yPos,
          width: signatureOptions.width,
          height: signatureOptions.height,
        });
        
        // Add signature info text below the image
        const signingTime = new Date().toLocaleString();
        targetPage.drawText(`Signed by: ${signedByName}`, {
          x: xPos,
          y: yPos - 20,
          size: 10,
        });
        
        targetPage.drawText(`Signed at: ${signingTime}`, {
          x: xPos,
          y: yPos - 35,
          size: 8,
        });
        
        // Add "DIGITALLY SIGNED" badge at top right
        targetPage.drawText("DIGITALLY SIGNED", {
          x: pageWidth - 150,
          y: pageHeight - 30,
          size: 10,
        });
        
        // Save the modified PDF
        const modifiedPdfBytes = await pdfDoc.save();
        
        const newFileName = `app_${signedDocumentId}_signed_${uuidv4().slice(0, 8)}.pdf`;
        const newPdfPath = path.join(docsDir, newFileName);
        fs.writeFileSync(newPdfPath, modifiedPdfBytes);
        
        const signedPdfBuffer = fs.readFileSync(newPdfPath);
        const signedBase64String = signedPdfBuffer.toString("base64");

        signedDoc.file_url = newFileName;
        signedDoc.signed_by_name = signedByName;
        signedDoc.signed_by_user_id = signedByUserId;
        signedDoc.signed_at = new Date();
        signedDoc.status = "verified";

        await signedDoc.save();

        console.log(`Signature stamped successfully: ${newFileName}`);
        return {
          success: true,
          signedDocumentId: signedDoc._id,
          filename: newFileName,
          base64: signedBase64String,
          mimeType: "application/pdf",
          signedAt: signedDoc.signed_at,
          signedBy: signedByName,
          message: "Document signed successfully",
        };
      }
    } catch (error) {
      console.error("Error stamping signature:", error);
      throw new Error(`Failed to stamp signature: ${error.message}`);
    }
  }

  /**
   * Get signed document by ID (returns base64)
   */
  async getSignedDocument(signedDocumentId) {
    try {
      const signedDoc = await SignedDocument.findById(signedDocumentId)
        .populate("template_id", "code title version")
        .populate("applicant_user_id", "first_name last_name email")
        .populate("loan_application_id", "application_no requested_loan_amount status")
        .lean();

      if (!signedDoc) {
        throw new Error("Signed document not found");
      }

      const pdfPath = path.join(docsDir, signedDoc.file_url);
      if (!fs.existsSync(pdfPath)) {
        throw new Error("Document file not found on server");
      }

      const pdfBuffer = fs.readFileSync(pdfPath);
      const base64String = pdfBuffer.toString("base64");

      return {
        success: true,
        document: {
          ...signedDoc,
          base64: base64String,
          mimeType: "application/pdf",
        },
        message: "Document retrieved successfully",
      };
    } catch (error) {
      console.error("Error retrieving document:", error);
      throw new Error(`Failed to retrieve document: ${error.message}`);
    }
  }

  /**
   * Get all signed documents for a loan application
   */
  async getApplicationDocuments(loanApplicationId) {
    try {
      const documents = await SignedDocument.find({
        loan_application_id: loanApplicationId,
      })
        .populate("template_id", "code title")
        .sort({ created_at: -1 })
        .lean();

      return {
        success: true,
        documents: documents,
        message: "Documents retrieved successfully",
      };
    } catch (error) {
      console.error("Error retrieving application documents:", error);
      throw new Error(`Failed to retrieve documents: ${error.message}`);
    }
  }

  /**
   * Delete a signed document
   */
  async deleteSignedDocument(signedDocumentId) {
    try {
      const signedDoc = await SignedDocument.findByIdAndDelete(signedDocumentId);

      if (!signedDoc) {
        throw new Error("Signed document not found");
      }

      const pdfPath = path.join(docsDir, signedDoc.file_url);
      if (fs.existsSync(pdfPath)) {
        fs.unlinkSync(pdfPath);
      }

      return {
        success: true,
        message: "Document deleted successfully",
      };
    } catch (error) {
      console.error("Error deleting document:", error);
      throw new Error(`Failed to delete document: ${error.message}`);
    }
  }
}

module.exports = new DocumentService();
