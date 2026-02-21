const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const { v4: uuidv4 } = require("uuid");
const DocumentTemplate = require("../models/document-template.model");
const SignedDocument = require("../models/signed-document.model");
const LoanApplication = require("../models/loanApplication.model");
const Loan = require("../models/loan.model");
const mongoose = require("mongoose");

// Ensure documents directory exists
const docsDir = path.join(__dirname, "../uploads/documents");
if (!fs.existsSync(docsDir)) {
  fs.mkdirSync(docsDir, { recursive: true });
}

class DocumentService {
  /**
   * Generate PDF from template with loan application data
   * Returns base64 encoded PDF
   */
  async generateDocumentFromTemplate(loanApplicationId, templateCode = "LOAN_REQUEST_FORM") {
    try {
      // Fetch loan application
      const application = await LoanApplication.findById(loanApplicationId).lean();
      if (!application) {
        throw new Error("Loan application not found");
      }

      // Fetch template
      const template = await DocumentTemplate.findOne({
        code: templateCode,
        is_active: true,
      }).lean();
      if (!template) {
        throw new Error(`Template not found: ${templateCode}`);
      }

      // Create PDF document
      const pdfDoc = new PDFDocument({ size: "A4", margin: 40 });

      // Generate unique filename
      const fileName = `app_${loanApplicationId}_${uuidv4().slice(0, 8)}.pdf`;
      const filePath = path.join(docsDir, fileName);

      // Create write stream
      const stream = fs.createWriteStream(filePath);
      pdfDoc.pipe(stream);

      // Add header
      pdfDoc
        .fontSize(16)
        .font("Helvetica-Bold")
        .text("REAL TIME CAPITAL", { align: "center" })
        .fontSize(12)
        .font("Helvetica")
        .text("Professional Pawn Services", { align: "center", color: "#6ba547" })
        .moveTo(50, pdfDoc.y + 10)
        .lineTo(550, pdfDoc.y + 10)
        .stroke()
        .moveDown();

      // Add template title
      pdfDoc
        .fontSize(14)
        .font("Helvetica-Bold")
        .text(template.title, { align: "center" })
        .moveDown();

      // Add document details
      pdfDoc.fontSize(10).font("Helvetica");

      // Personal Details Section
      pdfDoc
        .fontSize(12)
        .font("Helvetica-Bold")
        .text("PERSONAL INFORMATION", { underline: true })
        .moveDown(0.5);

      pdfDoc.font("Helvetica").fontSize(10);
      this._addField(pdfDoc, "Full Name:", application.full_name);
      this._addField(pdfDoc, "National ID:", application.national_id_number);
      this._addField(pdfDoc, "Date of Birth:", application.date_of_birth ? new Date(application.date_of_birth).toLocaleDateString() : "N/A");
      this._addField(pdfDoc, "Gender:", application.gender || "N/A");
      this._addField(pdfDoc, "Marital Status:", application.marital_status || "N/A");
      this._addField(pdfDoc, "Contact Number:", application.contact_details || "N/A");
      this._addField(pdfDoc, "Email Address:", application.email_address || "N/A");
      this._addField(pdfDoc, "Home Address:", application.home_address || "N/A");

      pdfDoc.moveDown();

      // Employment Details Section
      if (application.employment && Object.keys(application.employment).length > 0) {
        pdfDoc
          .fontSize(12)
          .font("Helvetica-Bold")
          .text("EMPLOYMENT INFORMATION", { underline: true })
          .moveDown(0.5);

        pdfDoc.font("Helvetica").fontSize(10);
        this._addField(pdfDoc, "Employment Type:", application.employment.employment_type || "N/A");
        this._addField(pdfDoc, "Job Title:", application.employment.title || "N/A");
        this._addField(pdfDoc, "Duration:", application.employment.duration || "N/A");
        this._addField(pdfDoc, "Location:", application.employment.location || "N/A");
        this._addField(pdfDoc, "Contact:", application.employment.contacts || "N/A");

        pdfDoc.moveDown();
      }

      // Loan Details Section
      pdfDoc
        .fontSize(12)
        .font("Helvetica-Bold")
        .text("LOAN DETAILS", { underline: true })
        .moveDown(0.5);

      pdfDoc.font("Helvetica").fontSize(10);
      this._addField(pdfDoc, "Application Number:", application.application_no);
      this._addField(pdfDoc, "Requested Loan Amount:", `$${application.requested_loan_amount.toFixed(2)}`);
      this._addField(pdfDoc, "Collateral Category:", application.collateral_category);
      this._addField(pdfDoc, "Collateral Description:", application.collateral_description || "N/A");
      this._addField(
        pdfDoc,
        "Declared Asset Value:",
        application.declared_asset_value ? `$${application.declared_asset_value.toFixed(2)}` : "N/A"
      );
      this._addField(pdfDoc, "Application Status:", application.status);
      this._addField(pdfDoc, "Application Date:", new Date(application.created_at).toLocaleDateString());

      pdfDoc.moveDown();

      // Declaration Section
      pdfDoc
        .fontSize(12)
        .font("Helvetica-Bold")
        .text("DECLARATION", { underline: true })
        .moveDown(0.5);

      pdfDoc.font("Helvetica").fontSize(9);
      const declarationText =
        application.declaration_text ||
        "I hereby declare that all the information provided above is true and accurate to the best of my knowledge. I agree to the terms and conditions of this loan agreement.";

      pdfDoc.text(declarationText, {
        align: "justify",
        width: 500,
      });

      pdfDoc.moveDown(1);

      // Signature area
      pdfDoc
        .fontSize(10)
        .font("Helvetica-Bold")
        .text("SIGNATURE OF APPLICANT", { underline: true })
        .moveDown(0.5);

      pdfDoc.font("Helvetica").fontSize(9).text("Signature will appear here", { color: "#999999" });
      pdfDoc.moveTo(50, pdfDoc.y + 30).lineTo(250, pdfDoc.y + 30).stroke();
      pdfDoc.fontSize(9).text("Signature", { align: "left" });

      pdfDoc.moveDown(1);
      pdfDoc.fontSize(9).text(`Date: ___________________`);

      // Footer
      pdfDoc.moveDown(1);
      pdfDoc
        .fontSize(8)
        .font("Helvetica")
        .text("© Real Time Capital - All Rights Reserved", { align: "center", color: "#666666" });

      // End PDF
      pdfDoc.end();

      // Wait for file to be written
      return new Promise((resolve, reject) => {
        stream.on("finish", async () => {
          try {
            // Read file and convert to base64
            const fileBuffer = fs.readFileSync(filePath);
            const base64String = fileBuffer.toString("base64");

            // Create SignedDocument record
            const signedDoc = new SignedDocument({
              template_id: template._id,
              template_code_snapshot: templateCode,
              applicant_user_id: application.customer_user,
              loan_application_id: loanApplicationId,
              file_url: fileName, // Store filename for later retrieval
              mime_type: "application/pdf",
              status: "uploaded",
            });

            await signedDoc.save();

            console.log(`PDF generated successfully: ${fileName}`);
            resolve({
              success: true,
              signedDocumentId: signedDoc._id,
              filename: fileName,
              base64: base64String,
              mimeType: "application/pdf",
              message: "Document generated successfully",
            });
          } catch (error) {
            reject(error);
          }
        });

        stream.on("error", (err) => {
          reject(err);
        });
      });
    } catch (error) {
      console.error("Error generating document:", error);
      throw new Error(`Failed to generate document: ${error.message}`);
    }
  }

  /**
   * Add a field to the PDF in a formatted way
   */
  _addField(pdfDoc, label, value) {
    const lineHeight = 14;
    pdfDoc.text(`${label} ${value || "N/A"}`, { width: 500 });
  }

  /**
   * Upload signature and stamp it on PDF (returns base64)
   * Signature should be base64 encoded image
   */
  async stampSignatureOnDocument(signedDocumentId, signatureBase64, signedByName, signedByUserId) {
    try {

      // Fetch signed document
      const signedDoc = await SignedDocument.findById(signedDocumentId);
      if (!signedDoc) {
        throw new Error("Signed document not found");
      }

      // Read original PDF
      const pdfPath = path.join(docsDir, signedDoc.file_url);
      if (!fs.existsSync(pdfPath)) {
        throw new Error("Original PDF file not found");
      }

      // Decode signature image from base64
      const signatureBuffer = Buffer.from(signatureBase64, "base64");

      // Process signature image - resize and optimize
      const processedSignature = await sharp(signatureBuffer)
        .resize(150, 80, { fit: "inside", withoutEnlargement: true })
        .png()
        .toBuffer();

      // Create new PDF with signature
      const newPdfDoc = new PDFDocument({ size: "A4", margin: 40 });
      const newFileName = `app_${signedDocumentId}_signed_${uuidv4().slice(0, 8)}.pdf`;
      const newPdfPath = path.join(docsDir, newFileName);

      const stream = fs.createWriteStream(newPdfPath);
      newPdfDoc.pipe(stream);

      // Read original PDF and copy content (simplified approach)
      // For production, consider using pdf-lib for more sophisticated merging
      const originalPdfBuffer = fs.readFileSync(pdfPath);

      // Add header
      newPdfDoc
        .fontSize(16)
        .font("Helvetica-Bold")
        .text("REAL TIME CAPITAL", { align: "center" })
        .fontSize(12)
        .font("Helvetica")
        .text("Professional Pawn Services", { align: "center", color: "#6ba547" })
        .moveTo(50, newPdfDoc.y + 10)
        .lineTo(550, newPdfDoc.y + 10)
        .stroke()
        .moveDown();

      newPdfDoc
        .fontSize(14)
        .font("Helvetica-Bold")
        .text("LOAN APPLICATION AGREEMENT (SIGNED)", { align: "center" })
        .moveDown();

      // Add some document info (recreate from original)
      newPdfDoc.fontSize(10).font("Helvetica");
      newPdfDoc
        .fontSize(11)
        .font("Helvetica-Bold")
        .text("Document Status: SIGNED", { color: "#6ba547" })
        .moveDown();

      // Add signature image
      newPdfDoc
        .fontSize(12)
        .font("Helvetica-Bold")
        .text("APPLICANT SIGNATURE", { underline: true })
        .moveDown(0.5);

      // Add signature image from buffer
      newPdfDoc.image(processedSignature, 50, newPdfDoc.y, {
        width: 150,
        height: 80,
      });

      newPdfDoc.moveDown(4);

      newPdfDoc.fontSize(10).font("Helvetica").text(`Signed by: ${signedByName}`);
      newPdfDoc.text(`Signed at: ${new Date().toLocaleString()}`);

      // Add footer
      newPdfDoc.moveDown(2);
      newPdfDoc
        .fontSize(8)
        .font("Helvetica")
        .text("© Real Time Capital - Document with Digital Signature", {
          align: "center",
          color: "#666666",
        });

      newPdfDoc.end();

      // Wait for file to be written
      return new Promise((resolve, reject) => {
        stream.on("finish", async () => {
          try {
            // Read signed PDF and convert to base64
            const signedPdfBuffer = fs.readFileSync(newPdfPath);
            const signedBase64String = signedPdfBuffer.toString("base64");

            // Update SignedDocument record
            signedDoc.file_url = newFileName;
            signedDoc.signed_by_name = signedByName;
            signedDoc.signed_by_user_id = signedByUserId;
            signedDoc.signed_at = new Date();
            signedDoc.status = "verified";

            await signedDoc.save();

            console.log(`Signature stamped successfully: ${newFileName}`);
            resolve({
              success: true,
              signedDocumentId: signedDoc._id,
              filename: newFileName,
              base64: signedBase64String,
              mimeType: "application/pdf",
              signedAt: signedDoc.signed_at,
              signedBy: signedByName,
              message: "Document signed successfully",
            });
          } catch (error) {
            reject(error);
          }
        });

        stream.on("error", (err) => {
          reject(err);
        });
      });
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

      // Read PDF file
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

      // Delete file from storage
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
