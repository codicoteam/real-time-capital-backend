const documentService = require("../services/document_service");

class SignedDocumentController {
  /**
   * Generate a document from template for a loan application
   * Returns PDF as base64
   */
  async generateDocument(req, res) {
    try {
      const { applicationId } = req.params;
      const { templateCode = "LOAN_REQUEST_FORM" } = req.body;

      // Validate applicationId
      if (!applicationId) {
        return res.status(400).json({
          success: false,
          error: "Application ID is required",
        });
      }

      const result = await documentService.generateDocumentFromTemplate(
        applicationId,
        templateCode
      );

      res.status(201).json({
        success: true,
        data: result,
        message: result.message,
      });
    } catch (error) {
      console.error("Error generating document:", error);
      res.status(400).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * Upload signature as file (image or PDF) and stamp it on document
   * Accepts multipart form data with signature file
   * 
   * Request can be sent as:
   * 1. Multipart form data (preferred):
   *    - file: signature image (PNG, JPG, JPEG, GIF) or PDF file
   *    - signedByName: name of the person signing (form field)
   *    - signatureOptions (optional): JSON string with placement options
   *      - x: X coordinate (from left)
   *      - y: Y coordinate (from bottom)
   *      - width: signature width
   *      - height: signature height
   *      - placeOnLastPage: true/false (default: true)
   * 
   * 2. JSON body with base64:
   *    - signatureBase64: base64 encoded signature
   *    - signedByName: name of the person signing
   *    - signatureOptions: object with placement options
   */
  async signDocument(req, res) {
    try {
      // Trim the documentId to handle any trailing whitespace/newlines from frontend
      const { documentId } = req.params;
      const trimmedDocumentId = documentId ? documentId.trim() : null;
      const userId = req.user ? req.user._id : null;

      // Validate documentId
      if (!trimmedDocumentId) {
        return res.status(400).json({
          success: false,
          error: "Document ID is required",
        });
      }

      // Check if file was uploaded (multipart form data)
      let signatureBase64 = null;
      let signedByName = null;
      let signatureOptions = {};

      if (req.file) {
        // File was uploaded via multipart/form-data - convert to base64
        const fileBuffer = req.file.buffer;
        const base64String = fileBuffer.toString("base64");
        const mimeType = req.file.mimetype;
        signatureBase64 = `data:${mimeType};base64,${base64String}`;
        
        // Get signedByName from form field or use filename as fallback
        signedByName = req.body.signedByName || req.body.signed_by_name || req.file.originalname;
        
        // Parse signature options from form field (JSON string)
        if (req.body.signatureOptions) {
          try {
            signatureOptions = typeof req.body.signatureOptions === 'string' 
              ? JSON.parse(req.body.signatureOptions) 
              : req.body.signatureOptions;
          } catch (parseError) {
            console.warn("Failed to parse signatureOptions:", parseError.message);
          }
        }
        
        console.log(`Processing uploaded signature file: ${req.file.originalname}, mimetype: ${mimeType}`);
      } else if (req.body.signatureBase64) {
        // Fallback: also support base64 string in body (JSON)
        signatureBase64 = req.body.signatureBase64;
        signedByName = req.body.signedByName || req.body.signed_by_name;
        
        // Get signature options from body
        if (req.body.signatureOptions) {
          signatureOptions = req.body.signatureOptions;
        }
        
        console.log("Processing signature from JSON body (base64)");
      }

      if (!signatureBase64 || !signedByName) {
        return res.status(400).json({
          success: false,
          error: "Signature and signedByName are required. " +
                 "Upload as multipart/form-data with field name 'signature' and 'signedByName', " +
                 "or send JSON body with signatureBase64 and signedByName",
        });
      }

      const result = await documentService.stampSignatureOnDocument(
        trimmedDocumentId,
        signatureBase64,
        signedByName,
        userId,
        signatureOptions
      );

      res.status(200).json({
        success: true,
        data: result,
        message: result.message,
      });
    } catch (error) {
      console.error("Error signing document:", error.message);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * Get a signed document by ID (returns base64)
   */
  async getSignedDocument(req, res) {
    try {
      const { documentId } = req.params;

      if (!documentId) {
        return res.status(400).json({
          success: false,
          error: "Document ID is required",
        });
      }

      const result = await documentService.getSignedDocument(documentId);

      res.status(200).json({
        success: true,
        data: result.document,
        message: result.message,
      });
    } catch (error) {
      console.error("Error retrieving document:", error);
      if (error.message.includes("not found")) {
        res.status(404).json({
          success: false,
          error: error.message,
        });
      } else {
        res.status(500).json({
          success: false,
          error: error.message,
        });
      }
    }
  }

  /**
   * Get all documents for a loan application
   */
  async getApplicationDocuments(req, res) {
    try {
      const { applicationId } = req.params;

      if (!applicationId) {
        return res.status(400).json({
          success: false,
          error: "Application ID is required",
        });
      }

      const result = await documentService.getApplicationDocuments(applicationId);

      res.status(200).json({
        success: true,
        data: result.documents,
        message: result.message,
      });
    } catch (error) {
      console.error("Error retrieving documents:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * Delete a signed document
   */
  async deleteSignedDocument(req, res) {
    try {
      const { documentId } = req.params;

      if (!documentId) {
        return res.status(400).json({
          success: false,
          error: "Document ID is required",
        });
      }

      const result = await documentService.deleteSignedDocument(documentId);

      res.status(200).json({
        success: true,
        data: result,
        message: result.message,
      });
    } catch (error) {
      console.error("Error deleting document:", error);
      if (error.message.includes("not found")) {
        res.status(404).json({
          success: false,
          error: error.message,
        });
      } else {
        res.status(500).json({
          success: false,
          error: error.message,
        });
      }
    }
  }
}

module.exports = new SignedDocumentController();
