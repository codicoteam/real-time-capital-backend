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
   * Upload signature and stamp it on document (signature should be base64)
   */
  async signDocument(req, res) {
    try {
      const { documentId } = req.params;
      const { signatureBase64, signedByName } = req.body;
      const userId = req.user._id;

      // Validate inputs
      if (!signatureBase64 || !signedByName) {
        return res.status(400).json({
          success: false,
          error: "signatureBase64 and signedByName are required",
        });
      }

      const result = await documentService.stampSignatureOnDocument(
        documentId,
        signatureBase64,
        signedByName,
        userId
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
